import { type Database, tasks } from "@agentos/db";
import type { TaskDto } from "@agentos/shared";
import type { Logger } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import type { SessionQueue } from "../queue/session.queue";
import { carryAttachments } from "./chain-attachments";

/**
 * Releases the next step of a template chain. This is the only way a later
 * step starts, which is what makes an approval gate a hard stop: a gated card
 * can only be closed by the operator, so nothing downstream of it moves until
 * they do (SPEC §9.3, §9.4).
 */
export async function releaseNextStep(
  db: Database,
  queue: SessionQueue,
  logger: Logger,
  closed: TaskDto,
): Promise<void> {
  if (!closed.chainId || closed.chainIndex === null) {
    return;
  }
  const next = await db.query.tasks.findFirst({
    where: and(eq(tasks.chainId, closed.chainId), eq(tasks.chainIndex, closed.chainIndex + 1)),
  });
  if (!next) {
    return;
  }
  // Before anything runs it: a step that inherits the previous step's files
  // must hold them by the time its container is provisioned.
  await carryAttachments(db, closed, next);
  if (next.assigneeType !== "agent" || !next.assigneeAgentId) {
    // A human step simply sits on the board waiting for the operator.
    logger.log(`chain ${closed.chainId} reached a human step: ${next.name}`);
    return;
  }
  // Keyed by the step being released: if two callers ever reach here for the
  // same step, the queue keeps one job rather than starting two agents.
  //
  // A failure here leaves the predecessor `done` and the successor waiting
  // with no job — the card is already committed, so this cannot be undone by
  // throwing. `releaseStalledChains` is what finds it later.
  try {
    await queue.enqueueRun(next.id, `chain-release-${next.id}`);
  } catch (error) {
    logger.error(
      `chain ${closed.chainId}: step "${next.name}" was released but could not be queued ` +
        `(${String(error)}); maintenance will retry it`,
    );
  }
}
