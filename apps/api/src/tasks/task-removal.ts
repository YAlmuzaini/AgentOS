import { type Database, sessions, tasks } from "@agentos/db";
import { TERMINAL_SESSION_STATUSES } from "@agentos/shared";
import { BadRequestException } from "@nestjs/common";
import { and, eq, notInArray } from "drizzle-orm";
import type { SessionQueue } from "../queue/session.queue";
import type { TaskRow } from "./tasks.service";

/**
 * Removes a task the operator no longer wants.
 *
 * Refused while a session is still working on it: the container outlives the
 * row, and deleting the row first leaves a running agent whose tool calls
 * resolve to nothing — it would keep spending with no way to reach it.
 * Cancel or let it finish, then delete.
 *
 * A scheduled task also has a queue entry keyed by its id, so that is
 * cancelled here rather than left to fire against a row that is gone.
 */
export async function removeTask(
  db: Database,
  queue: SessionQueue,
  task: TaskRow,
): Promise<void> {
  const live = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(
        eq(sessions.taskId, task.id),
        notInArray(sessions.status, [...TERMINAL_SESSION_STATUSES]),
      ),
    )
    .limit(1);
  if (live.length > 0) {
    throw new BadRequestException(
      "this task has a session still running — wait for it to finish before deleting it",
    );
  }

  await queue.cancelSchedule(task.id).catch(() => {
    // A schedule that was never installed is not an error; the delete below
    // is what actually matters.
  });
  await db.delete(tasks).where(eq(tasks.id, task.id));
}
