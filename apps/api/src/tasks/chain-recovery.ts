import { type Database, tasks } from "@agentos/db";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { DATABASE } from "../db/db.module";
import { SessionQueue } from "../queue/session.queue";

/**
 * Recovers chain steps whose release never reached the queue.
 *
 * `advanceChain` commits the predecessor as done and *then* enqueues, so a
 * queue outage in between leaves a chain that will never move on its own. This
 * is the sweep that finds those, and it is safe to run repeatedly because the
 * enqueue is keyed by the step being released.
 */
@Injectable()
export class ChainRecovery {
  private readonly logger = new Logger(ChainRecovery.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly queue: SessionQueue,
  ) {}

  /**
   * Re-releases chain steps whose enqueue was lost.
   *
   * A step is stalled when its predecessor is done, it is still `todo`, it is
   * assigned to an agent, and nothing has ever run it. Redis being down for a
   * moment should not wedge a chain until someone notices by hand.
   */
  async releaseStalledChains(): Promise<number> {
    const candidates = await this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.status, "todo"), eq(tasks.assigneeType, "agent")));

    let released = 0;
    for (const task of candidates) {
      if (!task.chainId || task.chainIndex === null || task.chainIndex === 0) {
        continue;
      }
      const previous = await this.db.query.tasks.findFirst({
        where: and(eq(tasks.chainId, task.chainId), eq(tasks.chainIndex, task.chainIndex - 1)),
      });
      if (previous?.status !== "done") {
        continue;
      }
      // The dedupe key makes this safe to run repeatedly: if the original job
      // is still queued, this is a no-op rather than a second container.
      await this.queue.enqueueRun(task.id, `chain-release-${task.id}`);
      this.logger.warn(`re-released stalled chain step "${task.name}"`);
      released += 1;
    }
    return released;
  }

}
