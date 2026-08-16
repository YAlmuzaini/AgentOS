import { Inject, Injectable, Logger } from "@nestjs/common";
import { ERROR_REPORTER, type ErrorReporter } from "../observability/error-reporter";
import { SessionsService } from "../sessions/sessions.service";
import type { Runner, RunnerHandle } from "./runner.types";

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
    try {
      await this.sessions.finish(sessionId, { status: "failed", error: String(error), costUsd });
    } catch (recordError) {
      this.logger.error(`session ${sessionId}: could not record the failure: ${String(recordError)}`);
    } finally {
      await this.destroyQuietly(runner, handle, sessionId);
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
      // Only now: the row keeps its vault ids until the credentials are
      // provably gone, which is what makes the retry queue self-maintaining.
      await this.sessions.clearVaults(sessionId);
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
        // Observed commits come from a workspace that is about to be deleted,
        // and this backend holds no push credential — it strips the token from
        // the remote after cloning. Recording the shas without saying that
        // would leave a session row implying work survived when it did not.
        // Written to the tool-call log because the event stream has ended by
        // now: this is the last thing the operator will read about the run.
        if (runner.name === "local") {
          await this.sessions.appendToolCalls(sessionId, [
            {
              at: new Date().toISOString(),
              type: "runner.warning",
              name: null,
              eventId: null,
              summary:
                `${commits.length} commit(s) existed only in this worker's workspace, which is ` +
                "now deleted: the local backend cannot push. Run git-write agents on the cloud " +
                "runner, whose runtime git proxy can.",
            },
          ]);
        }
      }
    } catch (error) {
      this.logger.warn(`session ${sessionId}: could not read its commits: ${String(error)}`);
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
    const costUsd = await runner.readCost(handle);
    try {
      await this.sessions.finish(sessionId, {
        status: failure ? "failed" : "destroyed",
        error: failure,
        costUsd,
      });
    } finally {
      await this.destroyQuietly(runner, handle, sessionId);
    }
    return costUsd;
  }
}
