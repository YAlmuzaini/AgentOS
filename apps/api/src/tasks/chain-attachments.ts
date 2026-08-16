import { type Database, taskTemplates, tasks } from "@agentos/db";
import { eq } from "drizzle-orm";

type TaskRow = typeof tasks.$inferSelect;

/**
 * Carries a finished step's attachments into the step that follows it.
 *
 * `attachmentsFromPrevious` is declared on every template step (SPEC §4) and
 * used to be declared and nothing else: the spec file written in step 1 never
 * reached the plan agent in step 2, so every later step worked from the prompt
 * alone. This is what makes the chain carry its own work forward.
 *
 * Returns the attachment ids the next step now holds.
 */
export async function carryAttachments(
  db: Database,
  previous: { attachmentIds: string[] },
  next: TaskRow,
): Promise<string[]> {
  if (previous.attachmentIds.length === 0 || next.chainIndex === null || !next.templateId) {
    return next.attachmentIds;
  }
  const template = await db.query.taskTemplates.findFirst({
    where: eq(taskTemplates.id, next.templateId),
  });
  const step = template?.steps[next.chainIndex];
  // A template that no longer exists, or a step that opted out, carries
  // nothing. Defaulting to "carry" would quietly widen what a step sees.
  if (!step?.attachmentsFromPrevious) {
    return next.attachmentIds;
  }

  const merged = [...new Set([...next.attachmentIds, ...previous.attachmentIds])];
  if (merged.length === next.attachmentIds.length) {
    return next.attachmentIds;
  }
  await db
    .update(tasks)
    .set({ attachmentIds: merged, updatedAt: new Date() })
    .where(eq(tasks.id, next.id));
  return merged;
}
