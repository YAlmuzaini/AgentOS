import { Inject, Injectable, Logger } from "@nestjs/common";
import { type SessionRow, SessionsService } from "../sessions/sessions.service";
import { type Runner, RUNNER_CLOUD } from "./runner.types";

/**
 * Deletes credential holders whose session is already gone.
 *
 * A vault outlives the container it belonged to, so "the session is over" does
 * not mean the credentials are gone. The session row keeps its vault ids until
 * a delete succeeds, which makes the row itself the retry queue — nothing
 * separate to keep in sync, and nothing forgotten because a process died
 * between the failure and the retry.
 */
@Injectable()
export class VaultCleanup {
  private readonly logger = new Logger(VaultCleanup.name);

  /** Pages of stranded-vault rows one maintenance pass will walk. */
  private static readonly PAGES = 20;

  constructor(
    private readonly sessions: SessionsService,
    @Inject(RUNNER_CLOUD) private readonly cloudRunner: Runner,
  ) {}

  /**
   * Retries credential cleanup for sessions whose destroy could not finish it.
   *
   * A vault outlives the container it belonged to, so "the session is over"
   * does not mean the credentials are gone. One transient 5xx during destroy
   * would otherwise strand them permanently.
   */
  async drain(): Promise<number> {
    if (!this.cloudRunner.deleteVaults) {
      return 0;
    }
    let cleared = 0;
    // Paged by a cursor rather than always taking the same oldest page. A
    // handful of rows whose deletion fails permanently — a revoked key, a
    // deleted workspace — would otherwise fill that page on every pass and
    // starve every newer credential behind them forever.
    let cursor: Date | null = null;
    for (let page = 0; page < VaultCleanup.PAGES; page += 1) {
      const batch = await this.sessions.sessionsWithPendingVaults(60, 100, cursor);
      if (batch.length === 0) {
        break;
      }
      cursor = batch[batch.length - 1]!.startedAt;
      cleared += await this.clearVaultBatch(batch);
    }
    return cleared;
  }

  /** Deletes one page of stranded vaults; a failure moves on to the next row. */
  private async clearVaultBatch(batch: SessionRow[]): Promise<number> {
    let cleared = 0;
    for (const session of batch) {
      if (session.runner !== "cloud" || !this.cloudRunner.deleteVaults) {
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

}
