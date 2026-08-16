import type { TaskDto } from "@agentos/shared";
import type { SessionQueue } from "../queue/session.queue";

/**
 * Turns the task's schedule into queue work. `now` runs immediately, `at`
 * runs once with a delay, `cron` installs a repeating scheduler keyed by the
 * task id so re-saving replaces rather than duplicates it (SPEC §9.2).
 */
export async function applySchedule(queue: SessionQueue, task: TaskDto): Promise<void> {
  if (task.assigneeType !== "agent" || !task.assigneeAgentId) {
    return;
  }
  switch (task.scheduleKind) {
    case "now":
      await queue.enqueueRun(task.id);
      return;
    case "at":
      if (task.runAt) {
        await queue.enqueueRunAt(task.id, new Date(task.runAt));
      }
      return;
    case "cron":
      if (task.cron && task.timezone) {
        await queue.scheduleCron(task.id, task.cron, task.timezone);
      }
      return;
  }
}
