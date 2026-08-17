import { Inject, Injectable, Logger } from "@nestjs/common";
import { SessionsService } from "../sessions/sessions.service";
import { SettingsService } from "../settings/settings.service";
import { LocalVmRunner } from "./local-runner";
import {
  type Runner,
  type RunnerHandle,
  RUNNER_CLOUD,
  safeToDestroyAfterPublish,
  type RuntimeSessionSummary,
} from "./runner.types";

/**
 * Reconciles what the runtimes are running against what AgentOS believes it
 * owns, and archives the difference.
 *
 * A container whose handle was never recorded is invisible to every other code
 * path; this is the only thing that will ever find it.
 */
@Injectable()
export class OrphanSweep {
  private readonly logger = new Logger(OrphanSweep.name);

  /**
   * A container younger than this is never swept, whatever the interval is set
   * to. `provision` and `attachRuntime` are two statements apart, and sweeping
   * inside that window would destroy a container that is about to be recorded.
   * Deliberately not a setting: zero here would kill live work.
   */
  private static readonly SWEEP_GRACE_MS = 10 * 60_000;

  constructor(
    private readonly sessions: SessionsService,
    private readonly settings: SettingsService,
    @Inject(RUNNER_CLOUD) private readonly cloudRunner: Runner,
    private readonly localRunner: LocalVmRunner,
  ) {}

  /**
   * Archives runtime containers AgentOS has no live session for.
   *
   * Both backends are swept. A local container is on a machine the operator
   * owns, which makes it easier to notice and no less expensive to leave
   * running.
   */
  async sweep(now = new Date()): Promise<number> {
    const enabled = new Set(await this.settings.projectsWithSweepEnabled());
    if (enabled.size === 0) {
      return 0;
    }
    // Whether a container of unknown ownership may be swept. If every project
    // wants sweeping there is nobody left to surprise; if even one has opted
    // out, an unattributable container might be theirs.
    const sweepUnattributed = enabled.size === (await this.settings.projectCount());

    const live = new Set(await this.sessions.liveRuntimeHandles());
    let swept = 0;

    for (const runner of [this.cloudRunner, this.localRunner as Runner]) {
      swept += await this.sweepRunner(runner, live, now, enabled, sweepUnattributed);
    }
    return swept;
  }

  private async sweepRunner(
    runner: Runner,
    live: Set<string>,
    now: Date,
    enabled: Set<string>,
    sweepUnattributed: boolean,
  ): Promise<number> {
    if (!runner.listRuntimeSessions) {
      return 0;
    }
    let swept = 0;
    let running: RuntimeSessionSummary[];
    try {
      running = await runner.listRuntimeSessions();
    } catch (error) {
      // An unreachable backend is not an empty backend. Saying so matters:
      // silence here reads exactly like "no orphans".
      this.logger.warn(`could not list ${runner.name} sessions to sweep: ${String(error)}`);
      return 0;
    }

    for (const candidate of running) {
      if (live.has(candidate.runtimeSessionId)) {
        continue;
      }
      if (now.getTime() - candidate.startedAt.getTime() < OrphanSweep.SWEEP_GRACE_MS) {
        continue;
      }
      const owner = candidate.projectId ?? null;
      if (owner === null ? !sweepUnattributed : !enabled.has(owner)) {
        this.logger.log(
          `leaving ${runner.name} container ${candidate.runtimeSessionId} alone: ` +
            `${owner ? "its project" : "its owner is unknown and some project"} has sweeping off`,
        );
        continue;
      }
      this.logger.warn(
        `orphaned ${runner.name} container ${candidate.runtimeSessionId} has no session in ` +
          "AgentOS; archiving it",
      );
      // Counted only when the destroy actually succeeded: a sweep that reports
      // work it did not do is worse than one that reports nothing.
      if (await this.destroy(runner, {
        runtimeSessionId: candidate.runtimeSessionId,
        traceUrl: null,
      })) {
        swept += 1;
      }
    }
    return swept;
  }

  private async destroy(runner: Runner, handle: RunnerHandle): Promise<boolean> {
    try {
      // An orphan has no session row, which makes it exactly the case where
      // nobody else will ever ask this container for its commits. Publishing
      // first is the difference between archiving a stray container and
      // destroying work that reached no remote.
      //
      // And the answer decides whether to destroy at all. Catching the failure
      // and carrying on was the same bug this sweep exists downstream of: a
      // session whose teardown deliberately left the container alone becomes
      // terminal, drops out of the live-handle set, and arrives here — where a
      // second failed publish followed by an unconditional destroy would throw
      // away exactly what the first refusal protected.
      if (runner.publish) {
        const outcome = await runner.publish(handle).catch((error: unknown) => {
          this.logger.warn(
            `could not publish ${handle.runtimeSessionId} before archiving it: ${String(error)}`,
          );
          return null;
        });
        const { safe, reason } = safeToDestroyAfterPublish(outcome);
        if (!safe) {
          this.logger.error(
            `not archiving ${handle.runtimeSessionId}: ${reason ?? "its commits are unconfirmed"}`,
          );
          return false;
        }
      }
      await runner.destroy(handle);
      return true;
    } catch (error) {
      this.logger.error(`could not destroy ${handle.runtimeSessionId}: ${String(error)}`);
      return false;
    }
  }
}
