import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import type IORedis from "ioredis";
import { REDIS } from "./tokens";

export const SESSION_QUEUE_NAME = "agentos.sessions";

/**
 * BullMQ 6.1.1's own rules for a custom job id, applied before it is handed
 * over — transcribed from `Job.validateOptions` in the installed version.
 *
 * This is exported so tests can validate through the same function rather than
 * a hand-copied approximation. A chain release is enqueued *after* its card
 * has already committed as done, so a job id the queue refuses does not fail
 * the request — it silently wedges the chain forever. That is what happened
 * with a `:` in the key, and the regression test missed it because the stub
 * that replaced this call did its own, weaker checking.
 */
export function assertValidJobId(jobId: string): void {
  if (`${Number.parseInt(jobId, 10)}` === jobId) {
    throw new Error(`job id "${jobId}" is an integer, which BullMQ rejects`);
  }
  // Not simply "contains a colon": BullMQ tolerates exactly two, for backward
  // compatibility with old repeatable-job ids.
  if (jobId.includes(":") && jobId.split(":").length !== 3) {
    throw new Error(`job id "${jobId}" contains ':', which BullMQ rejects`);
  }
}

/** Start a fresh session for a task. */
export interface RunTaskJob {
  kind: "run-task";
  taskId: string;
}

/** Resume a session parked on an inbox answer. */
export interface ResumeSessionJob {
  kind: "resume-session";
  sessionId: string;
  inboxMessageId: string;
}

/** One turn of a goal's gauntlet loop: evaluate, then dispatch or stop. */
export interface GoalIterationJob {
  kind: "goal-iteration";
  goalId: string;
}

/** One occurrence of a named cron automation. */
export interface AutomationFireJob {
  kind: "automation-fire";
  automationId: string;
}

/** Reap expired parked sessions and reconcile orphaned containers. */
export interface MaintenanceJob {
  kind: "maintenance";
}

export type SessionJob =
  | RunTaskJob
  | ResumeSessionJob
  | GoalIterationJob
  | AutomationFireJob
  | MaintenanceJob;

@Injectable()
export class SessionQueue implements OnModuleDestroy {
  private readonly queue: Queue<SessionJob>;

  constructor(@Inject(REDIS) connection: IORedis) {
    this.queue = new Queue<SessionJob>(SESSION_QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        // A container is expensive and side-effecting; a blind retry could
        // double-commit. Failures surface on the session row instead.
        attempts: 1,
        removeOnComplete: 500,
        removeOnFail: 500,
      },
    });
  }

  /**
   * `dedupeKey` makes the enqueue idempotent. A task the operator runs by hand
   * can legitimately run twice, so it is optional — but a chain release must
   * never start two agents for one step, and passing the step's own id there
   * makes a duplicate enqueue a no-op rather than a second container.
   */
  async enqueueRun(taskId: string, dedupeKey?: string): Promise<void> {
    if (dedupeKey) {
      assertValidJobId(dedupeKey);
    }
    await this.queue.add(
      "run-task",
      { kind: "run-task", taskId },
      dedupeKey ? { jobId: dedupeKey } : undefined,
    );
  }

  /** Scheduled-once task (SPEC §9.2). */
  async enqueueRunAt(taskId: string, runAt: Date): Promise<void> {
    const delay = Math.max(0, runAt.getTime() - Date.now());
    await this.queue.add("run-task", { kind: "run-task", taskId }, { delay });
  }

  /**
   * Recurring task. Keyed by task id so re-saving a task replaces its schedule
   * instead of stacking a second one.
   */
  async scheduleCron(taskId: string, cron: string, timezone: string): Promise<void> {
    await this.queue.upsertJobScheduler(
      schedulerId(taskId),
      { pattern: cron, tz: timezone },
      { name: "run-task", data: { kind: "run-task", taskId } },
    );
  }

  async cancelSchedule(taskId: string): Promise<void> {
    await this.queue.removeJobScheduler(schedulerId(taskId));
  }

  async scheduleAutomation(automationId: string, cron: string, timezone: string): Promise<void> {
    await this.queue.upsertJobScheduler(
      automationSchedulerId(automationId),
      { pattern: cron, tz: timezone },
      { name: "automation-fire", data: { kind: "automation-fire", automationId } },
    );
  }

  async cancelAutomation(automationId: string): Promise<void> {
    await this.queue.removeJobScheduler(automationSchedulerId(automationId));
  }

  /**
   * The maintenance heartbeat. Keyed by a constant so re-scheduling it at a new
   * interval replaces the schedule rather than stacking a second one.
   */
  async scheduleMaintenance(everyMinutes: number): Promise<void> {
    await this.queue.upsertJobScheduler(
      MAINTENANCE_SCHEDULER_ID,
      { every: everyMinutes * 60_000 },
      { name: "maintenance", data: { kind: "maintenance" } },
    );
  }

  /**
   * One turn of a goal's loop.
   *
   * `dedupeKey` is used by recovery, where the same stalled goal can be seen by
   * two overlapping maintenance passes. The normal chained enqueue passes none:
   * consecutive turns are genuinely different jobs, and a key would make the
   * second one a no-op against the first's leftover id.
   */
  async enqueueGoalIteration(goalId: string, dedupeKey?: string): Promise<void> {
    if (dedupeKey) {
      assertValidJobId(dedupeKey);
    }
    await this.queue.add(
      "goal-iteration",
      { kind: "goal-iteration", goalId },
      dedupeKey ? { jobId: dedupeKey } : undefined,
    );
  }

  async enqueueResume(sessionId: string, inboxMessageId: string): Promise<void> {
    await this.queue.add("resume-session", {
      kind: "resume-session",
      sessionId,
      inboxMessageId,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}

const MAINTENANCE_SCHEDULER_ID = "maintenance";

function schedulerId(taskId: string): string {
  return `task:${taskId}`;
}

function automationSchedulerId(automationId: string): string {
  return `automation:${automationId}`;
}
