import { Inject, Injectable, Logger } from "@nestjs/common";
import { GoalContinuity } from "../goals/goal-continuity";
import { InboxService } from "../inbox/inbox.service";
import { ERROR_REPORTER, type ErrorReporter } from "../observability/error-reporter";
import { PushService } from "../push/push.service";
import { type SessionRow, SessionsService } from "../sessions/sessions.service";
import { SettingsService } from "../settings/settings.service";
import { ChainRecovery } from "../tasks/chain-recovery";
import { LocalVmRunner } from "./local-runner";
import { OrphanSweep } from "./orphan-sweep";
import { VaultCleanup } from "./vault-cleanup";
import {
  type Runner,
  type RunnerHandle,
  RUNNER_CLOUD,
  safeToDestroyAfterPublish,
  type RuntimeSessionSummary,
} from "./runner.types";

/**
 * The two jobs nobody is watching (SPEC §6, "destroyed on every exit path").
 *
 * A parked session holds its container on purpose — that is the whole point of
 * the inbox — but "until the operator answers" has to have an end, or an
 * unanswered question bills forever. And a container whose handle was never
 * persisted is invisible to every other code path, so something has to
 * reconcile the runtime against what AgentOS believes it owns.
 *
 * Both are settings, not constants: how long you are willing to hold a
 * container is a judgement about your own working hours, not a fact about the
 * software.
 */
@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  /**
   * A container younger than this is never swept, whatever the interval is set
   * to. `provision` and `attachRuntime` are two statements apart, and sweeping
   * inside that window would destroy a container that is about to be recorded.
   * Deliberately not a setting: zero here would kill live work.
   */
  private static readonly SWEEP_GRACE_MS = 10 * 60_000;

  constructor(
    private readonly sessions: SessionsService,
    private readonly inbox: InboxService,
    private readonly settings: SettingsService,
    private readonly chains: ChainRecovery,
    private readonly goals: GoalContinuity,
    private readonly orphans: OrphanSweep,
    private readonly vaults: VaultCleanup,
    @Inject(ERROR_REPORTER) private readonly errors: ErrorReporter,
    private readonly push: PushService,
    @Inject(RUNNER_CLOUD) private readonly cloudRunner: Runner,
    private readonly localRunner: LocalVmRunner,
  ) {}

  /** One maintenance pass. A failure in one job must not skip the others. */
  async run(): Promise<{
    reaped: number;
    swept: number;
    vaultsCleared: number;
    released: number;
    goalsRecovered: number;
  }> {
    // Every one of these is reported, not just logged. This is the job nobody
    // watches: an orphan sweep that 400s on every pass reports zero orphans
    // forever, and that is exactly how it went unnoticed once already.
    const reaped = await this.guard("reap-parked", () => this.reapParkedSessions());
    const swept = await this.guard("orphan-sweep", () => this.orphans.sweep());
    const vaultsCleared = await this.guard("vault-cleanup", () => this.vaults.drain());
    const released = await this.guard("chain-release", () => this.chains.releaseStalledChains());
    // Runs last: reaping above can be what leaves a goal with nothing queued.
    const goalsRecovered = await this.guard("goal-recovery", () =>
      this.goals.recoverStalledGoals(),
    );
    return { reaped, swept, vaultsCleared, released, goalsRecovered };
  }

  /** Runs one maintenance job; a failure in it must not skip the others. */
  private async guard(job: string, run: () => Promise<number>): Promise<number> {
    try {
      return await run();
    } catch (error) {
      this.errors.capture(error, { scope: `maintenance.${job}` });
      return 0;
    }
  }

  /**
   * Frees containers whose question went unanswered past the project's timeout.
   *
   * The question itself is kept — the message is closed, not deleted — because
   * what the agent wanted to know is usually still worth reading after the
   * container is gone.
   */
  async reapParkedSessions(now = new Date()): Promise<number> {
    let reaped = 0;
    // Grouped by project because the timeout is per project, and a project
    // that sets 0 opts out entirely.
    for (const [projectId, parked] of await this.parkedByProject()) {
      const settings = await this.settings.read(projectId);
      if (settings.parkedSessionTimeoutMinutes === 0) {
        continue;
      }
      const cutoff = new Date(now.getTime() - settings.parkedSessionTimeoutMinutes * 60_000);
      for (const session of parked) {
        if (!session.parkedAt || session.parkedAt > cutoff) {
          continue;
        }
        if (await this.expire(session, settings.parkedSessionTimeoutMinutes)) {
          reaped += 1;
        }
      }
    }
    return reaped;
  }

  /**
   * Ends one abandoned session.
   *
   * The claim comes first. An operator answering at the same moment moves the
   * session out of `waiting-inbox`, and reaping it then would destroy a live
   * run out from under a real answer — so only the caller that wins the
   * conditional update proceeds.
   */
  private async expire(session: SessionRow, timeoutMinutes: number): Promise<boolean> {
    const reason =
      `no answer within ${timeoutMinutes} minutes; the container was freed. ` +
      "The question is still on the closed message.";

    if (!(await this.sessions.claimExpiredPark(session.id, reason))) {
      this.logger.log(`session ${session.id} left the park before it could be reaped`);
      return false;
    }
    this.logger.warn(`session ${session.id} expired waiting on the inbox`);

    let costUsd: number | null = null;
    try {
      // Reported rather than thrown: this session is already claimed and
      // terminal, so nothing will reap it a second time. Letting the failure
      // escape would skip freeing the container *and* stopping the goal.
      await this.inbox
        .closeForSession(session.id, reason)
        .catch((error: unknown) =>
          this.errors.capture(error, {
            scope: "maintenance.close-question",
            tags: { sessionId: session.id },
          }),
        );
    } finally {
      // The container is freed even if closing the message failed: the record
      // being wrong is recoverable, a container nobody is watching is not.
      if (session.runtimeHandle) {
        const runner = session.runner === "local" ? this.localRunner : this.cloudRunner;
        const handle = {
          runtimeSessionId: session.runtimeHandle,
          traceUrl: null,
          // Without these the reaper archives the session and leaves its
          // credentials behind — the leak this whole path exists to prevent.
          vaultIds: session.runtimeVaultIds,
        };
        // Read while the container still exists. A parked goal session has
        // already spent everything it spent before asking its question, and
        // that money was never reaching the goal's cap from here.
        costUsd = await runner.readCost(handle).catch((error: unknown) => {
          this.logger.warn(`could not read spend for ${handle.runtimeSessionId}: ${String(error)}`);
          return null;
        });
        // A parked session that is being reaped may hold commits: it asked a
        // question after doing work, and nobody answered. Publishing before
        // the destroy is the same rule teardown follows, and this path had it
        // missing — the timeout deleted the workspace and the commits with it.
        //
        // The answer also decides whether to destroy. Reaping frees a
        // container, which matters most on the cloud runner where one costs
        // money; the local worker costs disk, and disk is the cheaper thing to
        // spend than an afternoon of commits.
        if (await this.publishedSafely(runner, handle, session.id)) {
          await this.destroy(session.id, runner, handle);
        }
      }
    }

    // A goal whose specialist is reaped has nothing left to queue its next
    // turn: the resume that would have done it is never going to happen. Left
    // alone the goal sits `active` forever, with no session, no job, and
    // nothing said about it.
    if (session.goalId) {
      // Guarded on its own. This is the step that stops the goal, and skipping
      // it leaves a goal `active` with no session and no queued turn — which
      // recovery would then "fix" by dispatching past the very decision the
      // operator declined to make.
      await this.goals
        .abandonAfterReap(session.goalId, reason, costUsd)
        .catch((error: unknown) =>
          this.errors.capture(error, {
            scope: "maintenance.abandon-goal",
            tags: { goalId: session.goalId, sessionId: session.id },
          }),
        );
    }

    await this.push.send({
      title: "A question timed out",
      body: `An agent stopped waiting after ${timeoutMinutes} minutes.`,
      url: "/inbox",
    });
    return true;
  }

  /**
   * Destroys, and records it on the session row when that fails.
   *
   * This is the one job whose entire purpose is to stop containers leaking, so
   * a failure here has to end up somewhere the operator looks — not only in a
   * log line nobody reads.
   */
  /**
   * Pushes a reaped session's commits, if the backend can.
   *
   * Best effort and never fatal: this path exists to free a container, and a
   * push that fails must not stop that. The worker keeps the workspace itself
   * when a push fails, so the work is still recoverable either way.
   */
  private async publishedSafely(
    runner: Runner,
    handle: RunnerHandle,
    sessionId: string,
  ): Promise<boolean> {
    if (!runner.publish) {
      return true;
    }
    const outcome = await runner.publish(handle).catch((error: unknown) => {
      this.logger.warn(`session ${sessionId}: could not publish before reaping: ${String(error)}`);
      return null;
    });
    const { safe, reason } = safeToDestroyAfterPublish(outcome);
    if (!safe) {
      this.logger.error(`session ${sessionId}: not reaping its container — ${reason}`);
      return false;
    }
    if (outcome?.retainedWorkspace) {
      this.logger.error(
        `session ${sessionId}: reaped with unpushed commits; workspace kept at ` +
          outcome.retainedWorkspace,
      );
    }
    return true;
  }

  private async destroy(
    sessionId: string | null,
    runner: Runner,
    handle: RunnerHandle,
  ): Promise<boolean> {
    try {
      await runner.destroy(handle);
      if (sessionId) {
        await this.sessions.clearVaults(sessionId);
        // The reaper destroys containers too, so it records the release as
        // teardown does. Omitting it left every session this path finished
        // permanently undeletable: the row claimed a runtime that was gone.
        await this.sessions.markRuntimeReleased(sessionId);
      }
      return true;
    } catch (error) {
      this.logger.error(`could not destroy ${handle.runtimeSessionId}: ${String(error)}`);
      if (sessionId) {
        await this.sessions
          .recordDestroyFailure(sessionId, String(error))
          .catch((recordError: unknown) => this.logger.error(String(recordError)));
      }
      return false;
    }
  }

  private async parkedByProject(): Promise<Map<string, SessionRow[]>> {
    // Everything currently parked; the per-project cutoff is applied above.
    const parked = await this.sessions.listParkedSince(new Date());
    const byProject = new Map<string, SessionRow[]>();
    for (const session of parked) {
      const existing = byProject.get(session.projectId);
      if (existing) {
        existing.push(session);
      } else {
        byProject.set(session.projectId, [session]);
      }
    }
    return byProject;
  }

}
