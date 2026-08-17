import { Inject, Injectable, Logger } from "@nestjs/common";
import { ERROR_REPORTER, type ErrorReporter } from "../observability/error-reporter";
import { SessionsService } from "../sessions/sessions.service";
import { safeToDestroyAfterPublish, type Runner, type RunnerHandle } from "./runner.types";

/**
 * Ending a session: recording what happened, and freeing the container.
 *
 * Separate from the orchestrator because the ordering rules here are the whole
 * point — the container is released on every path, including the ones where
 * writing the record is what failed.
 */
@Injectable()
export class SessionTeardown {
  private readonly logger = new Logger(SessionTeardown.name);

  constructor(
    private readonly sessions: SessionsService,
    @Inject(ERROR_REPORTER) private readonly errors: ErrorReporter,
  ) {}

  /**
   * Records the failure and frees the container, in that order but never
   * conditionally on it.
   *
   * The recording is the part most likely to be *what* failed — a database
   * outage takes down `sessions.finish` and every session in flight at once.
   * Destroying inside a `finally` means the container still goes away exactly
   * when the control plane is least able to notice it did not.
   */
  async failAndRelease(
    runner: Runner,
    handle: RunnerHandle | null,
    sessionId: string,
    error: unknown,
  ): Promise<number | null> {
    this.logger.error(`session ${sessionId} failed: ${String(error)}`);
    // A session that failed after provisioning has usually already spent money,
    // and once the container is gone there is nothing left to ask. Booking $0
    // for it let a goal re-dispatch against the full remaining budget after
    // every failure — a repeatable failure could spend the cap many times over
    // while the cap read as untouched.
    const costUsd = await this.readCostQuietly(runner, handle);
    // A run that broke half way still committed real work, and the workspace is
    // about to go. Collecting and pushing here as well as on the success path is
    // the difference between "the session failed" and "the session failed and
    // took three hours of commits with it".
    let safeToDestroy = true;
    if (handle) {
      await this.collectCommits(runner, handle, sessionId);
      ({ safeToDestroy } = await this.publish(runner, handle, sessionId));
    }
    try {
      await this.sessions.finish(sessionId, { status: "failed", error: String(error), costUsd });
    } catch (recordError) {
      this.logger.error(`session ${sessionId}: could not record the failure: ${String(recordError)}`);
    } finally {
      if (safeToDestroy) {
        await this.destroyQuietly(runner, handle, sessionId);
      } else {
        await this.deferDestroy(sessionId);
      }
    }
    return costUsd;
  }

  /**
   * Spend, or null when it cannot be read.
   *
   * This runs on the failure path, where something has already gone wrong. A
   * cost readout that also fails must not replace the original error or skip
   * the destroy that follows it.
   */
  private async readCostQuietly(
    runner: Runner,
    handle: RunnerHandle | null,
  ): Promise<number | null> {
    if (!handle) {
      return null;
    }
    try {
      return await runner.readCost(handle);
    } catch (error) {
      this.logger.warn(`could not read spend for ${handle.runtimeSessionId}: ${String(error)}`);
      return null;
    }
  }

  /**
   * Records that the container was deliberately left running.
   *
   * Only reachable on the local backend, and only when we could not ask it
   * whether the work was pushed. A local workspace costs disk on a machine the
   * operator owns; deleting commits that exist nowhere else costs the run. The
   * row keeps its runtime handle, so the orphan sweep and any later teardown
   * find it again.
   */
  private async deferDestroy(sessionId: string): Promise<void> {
    await this.sessions
      .recordDestroyFailure(
        sessionId,
        "the workspace was not destroyed: this session's commits could not be confirmed as " +
          "pushed, and deleting it could have discarded the only copy. Retry once the worker " +
          "is reachable.",
      )
      .catch((error: unknown) =>
        this.logger.error(`session ${sessionId}: ${String(error)}`),
      );
  }

  /**
   * The destroy that runs when something has already gone wrong.
   *
   * A failed run still holds a container, and a container nobody is watching
   * bills until someone notices. The failure that brought us here is the one
   * worth reporting, so a destroy that also fails is logged and swallowed
   * rather than replacing it.
   */
  async destroyQuietly(
    runner: Runner,
    handle: RunnerHandle | null,
    sessionId: string,
  ): Promise<void> {
    if (!handle) {
      return;
    }
    try {
      await runner.destroy(handle);
    } catch (error) {
      // A container that outlived its session bills until a human notices, and
      // the whole point of this product is that no human is looking.
      this.errors.capture(error, {
        scope: "session.destroy",
        tags: { sessionId, runtimeSessionId: handle.runtimeSessionId, runner: runner.name },
      });
      // The row must not claim a clean end the runtime never gave us.
      await this.sessions
        .recordDestroyFailure(sessionId, String(error))
        .catch((recordError: unknown) =>
          this.logger.error(`session ${sessionId}: ${String(recordError)}`),
        );
      return;
    }

    // Outside the try, because a database failure here is not a destroy
    // failure: the container really is gone, and recording "container was not
    // destroyed" would send someone hunting for one that does not exist.
    try {
      // The row keeps its vault ids until the credentials are provably gone,
      // which is what makes the retry queue self-maintaining; and
      // `markRuntimeReleased` is what later allows the row to be deleted.
      await this.sessions.clearVaults(sessionId);
      await this.sessions.markRuntimeReleased(sessionId);
    } catch (error) {
      this.logger.error(
        `session ${sessionId}: destroyed, but the row could not be updated: ${String(error)}`,
      );
    }
  }

  /**
   * The commit step of SPEC §6, and the only window there is for it.
   *
   * A backend that still holds the checkout is asked what was committed while
   * the workspace exists; a moment later the container is gone and the answer
   * is unobtainable. The session is marked `committing` for the duration, so
   * the state the spec names is a state the operator can actually see.
   *
   * Never fatal: a session that produced work and could not be asked about it
   * still has to end and still has to be destroyed.
   */
  private async collectCommits(
    runner: Runner,
    handle: RunnerHandle,
    sessionId: string,
  ): Promise<void> {
    if (!runner.collectCommits) {
      return;
    }
    try {
      await this.sessions.setStatus(sessionId, "committing");
      const commits = await runner.collectCommits(handle);
      if (commits.length > 0) {
        await this.sessions.recordCommits(
          sessionId,
          commits.map((commit) => commit.sha),
        );
        this.logger.log(
          `session ${sessionId} produced ${commits.length} commit(s): ` +
            commits.map((commit) => `${commit.repo}@${commit.sha.slice(0, 8)}`).join(", "),
        );
      }
    } catch (error) {
      this.logger.warn(`session ${sessionId}: could not read its commits: ${String(error)}`);
    }
  }

  /**
   * Pushes the session's commits, while there is still a workspace to push
   * from.
   *
   * This is the step that makes a local coding session mean anything. The
   * agent commits into a directory that is about to be deleted and holds no
   * push credential — the clone's remote is stripped of its token precisely so
   * the agent cannot reach one. The worker kept that token, so the worker does
   * the push, here, after the run has ended.
   *
   * Never fatal. A push that fails must not stop the session from ending; what
   * it does instead is make the worker keep the workspace, and the row below is
   * how the operator finds out where.
   */
  private async publish(
    runner: Runner,
    handle: RunnerHandle,
    sessionId: string,
  ): Promise<{ safeToDestroy: boolean }> {
    if (!runner.publish) {
      return { safeToDestroy: true };
    }
    try {
      const outcome = await runner.publish(handle);
      if (outcome.forgotten) {
        // Worth a line on the session, because nothing else will say it: if
        // this run committed anything, it is now in a directory on the worker
        // rather than on a remote.
        await this.sessions.appendToolCalls(sessionId, [
          {
            at: new Date().toISOString(),
            type: "runner.warning",
            name: null,
            eventId: null,
            summary:
              "the local worker restarted before this session's commits could be pushed. If it " +
              "produced any, the worker kept its workspace under a `quarantine-` directory — " +
              "recover them there, then remove it.",
          },
        ]);
        return { safeToDestroy: true };
      }
      if (outcome.records.length === 0) {
        return { safeToDestroy: true };
      }
      await this.sessions.recordPublish(sessionId, outcome);

      const failed = outcome.records.filter((record) => !record.pushed);
      const pushed = outcome.records.filter((record) => record.pushed && record.commits > 0);
      if (pushed.length > 0) {
        this.logger.log(
          `session ${sessionId} pushed ${pushed.map((r) => `${r.repo}→${r.branch}`).join(", ")}`,
        );
      }
      if (failed.length === 0) {
        return { safeToDestroy: true };
      }

      // The event stream has ended by now, so the tool-call log is the last
      // place the operator will read anything about this run — and a failed
      // push is the one outcome they have to act on by hand.
      await this.sessions.appendToolCalls(sessionId, [
        {
          at: new Date().toISOString(),
          type: "runner.warning",
          name: null,
          eventId: null,
          summary:
            `could not push ${failed.map((r) => `${r.repo} (${r.error ?? "unknown error"})`).join("; ")}` +
            (outcome.retainedWorkspace
              ? `. The worker kept the workspace at ${outcome.retainedWorkspace} rather than ` +
                "deleting the only copy of the work — recover it by hand, then remove the directory."
              : "."),
        },
      ]);
      this.logger.error(
        `session ${sessionId}: push failed for ${failed.map((r) => r.repo).join(", ")}` +
          (outcome.retainedWorkspace ? `; workspace retained at ${outcome.retainedWorkspace}` : ""),
      );
      return { safeToDestroy: safeToDestroyAfterPublish(outcome).safe };
    } catch (error) {
      // We could not even ask. That is the dangerous case: the worker may be
      // holding a workspace full of commits that reached no remote, and
      // destroying it now would delete the only copy. Leave it. The session
      // stays visible to the worker's own listing, so the orphan sweep and a
      // later teardown are real retries — and a local workspace costs disk,
      // not money, which is the trade worth making here.
      this.logger.error(
        `session ${sessionId}: could not publish its commits (${String(error)}); ` +
          "the workspace is being left in place rather than destroyed, because it may hold " +
          "commits that exist nowhere else",
      );
      return { safeToDestroy: false };
    }
  }

  /**
   * Reads spend, closes the session record, then frees the container.
   *
   * The destroy is in a `finally` for the same reason as the failure path: if
   * writing the record throws, the container must still go away. A row that
   * says "running" next to a container that does not exist is a nuisance; a
   * container that exists with no row is a bill.
   */
  async finish(
    runner: Runner,
    handle: RunnerHandle,
    sessionId: string,
    failure: string | null,
  ): Promise<number | null> {
    await this.collectCommits(runner, handle, sessionId);
    // After collecting, before destroying — the only window where the commits
    // both exist and are still reachable. Runs on the failure path too: a
    // session that broke half way still committed real work, and throwing it
    // away because the run ended badly is the loss this whole path exists to
    // prevent. The branch is the operator's to review either way.
    const { safeToDestroy } = await this.publish(runner, handle, sessionId);
    const costUsd = await runner.readCost(handle);
    try {
      await this.sessions.finish(sessionId, {
        status: failure ? "failed" : "destroyed",
        error: failure,
        costUsd,
      });
    } finally {
      if (safeToDestroy) {
        await this.destroyQuietly(runner, handle, sessionId);
      } else {
        await this.deferDestroy(sessionId);
      }
    }
    return costUsd;
  }
}
