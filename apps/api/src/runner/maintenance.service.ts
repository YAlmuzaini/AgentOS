import { Inject, Injectable, Logger } from "@nestjs/common";
import { InboxService } from "../inbox/inbox.service";
import { PushService } from "../push/push.service";
import { type SessionRow, SessionsService } from "../sessions/sessions.service";
import { SettingsService } from "../settings/settings.service";
import { ChainRecovery } from "../tasks/chain-recovery";
import { LocalVmRunner } from "./local-runner";
import { OrphanSweep } from "./orphan-sweep";
import {
  type Runner,
  type RunnerHandle,
  RUNNER_CLOUD,
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
    private readonly orphans: OrphanSweep,
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
  }> {
    const reaped = await this.reapParkedSessions().catch((error) => {
      this.logger.error(`reaping parked sessions failed: ${String(error)}`);
      return 0;
    });
    const swept = await this.orphans.sweep().catch((error) => {
      this.logger.error(`orphan sweep failed: ${String(error)}`);
      return 0;
    });
    const vaultsCleared = await this.retryPendingVaultCleanups().catch((error) => {
      this.logger.error(`vault cleanup retry failed: ${String(error)}`);
      return 0;
    });
    const released = await this.chains.releaseStalledChains().catch((error) => {
      this.logger.error(`stalled chain release failed: ${String(error)}`);
      return 0;
    });
    return { reaped, swept, vaultsCleared, released };
  }

  /**
   * Retries credential cleanup for sessions whose destroy could not finish it.
   *
   * A vault outlives the container it belonged to, so "the session is over"
   * does not mean the credentials are gone. One transient 5xx during destroy
   * would otherwise strand them permanently.
   */
  async retryPendingVaultCleanups(): Promise<number> {
    if (!this.cloudRunner.deleteVaults) {
      return 0;
    }
    let cleared = 0;
    for (const session of await this.sessions.sessionsWithPendingVaults()) {
      if (session.runner !== "cloud") {
        continue;
      }
      try {
        await this.cloudRunner.deleteVaults(session.runtimeVaultIds);
        await this.sessions.clearVaults(session.id);
        // A session stranded mid-provision is finished, whatever its row says:
        // its credentials are gone and nothing is going to attach a runtime to
        // it now.
        if (session.status === "starting") {
          await this.sessions.finish(session.id, {
            status: "failed",
            error: "provisioning did not complete; its credentials were cleaned up",
          });
        }
        this.logger.log(`cleaned up ${session.runtimeVaultIds.length} stranded vault(s)`);
        cleared += 1;
      } catch (error) {
        this.logger.warn(`vault cleanup for session ${session.id} failed again: ${String(error)}`);
      }
    }
    return cleared;
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

    try {
      await this.inbox.closeForSession(session.id, reason);
    } finally {
      // The container is freed even if closing the message failed: the record
      // being wrong is recoverable, a container nobody is watching is not.
      if (session.runtimeHandle) {
        const runner = session.runner === "local" ? this.localRunner : this.cloudRunner;
        await this.destroy(session.id, runner, {
          runtimeSessionId: session.runtimeHandle,
          traceUrl: null,
          // Without these the reaper archives the session and leaves its
          // credentials behind — the leak this whole path exists to prevent.
          vaultIds: session.runtimeVaultIds,
        });
      }
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
  private async destroy(
    sessionId: string | null,
    runner: Runner,
    handle: RunnerHandle,
  ): Promise<boolean> {
    try {
      await runner.destroy(handle);
      if (sessionId) {
        await this.sessions.clearVaults(sessionId);
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
