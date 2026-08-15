import { type Database, goals, sessions } from "@agentos/db";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, asc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { DATABASE } from "../db/db.module";
import { PushService } from "../push/push.service";
import { SessionQueue } from "../queue/session.queue";
import { GoalLogService } from "./goal-log.service";
import { LEASE_MINUTES } from "./goals.service";

/**
 * Keeps a goal either moving or honestly stopped.
 *
 * The gauntlet loop is a chain of queue jobs: each iteration is what enqueues
 * the next. That makes every link a place where the goal can simply stop
 * existing as far as the queue is concerned — a Redis blip when the successor
 * is enqueued, an evaluator that threw, a worker killed mid-dispatch, or a
 * specialist parked on a question the operator never answered. In every one of
 * those the goal row still says `active`, nothing is queued, and no error is
 * anywhere the operator looks. This is the sweep that ends that state.
 *
 * Deliberately outside `GoalsModule`: maintenance lives in the runner, and the
 * runner is already what the goal orchestrator depends on. Only the globally
 * provided database and queue are needed here, so there is no cycle to break.
 */
@Injectable()
export class GoalContinuity {
  private readonly logger = new Logger(GoalContinuity.name);

  /**
   * How long a goal must sit untouched before it counts as stalled. Longer
   * than a dispatch takes to write its first log line, so a goal that is
   * merely busy is never re-queued underneath itself.
   */
  private static readonly STALL_GRACE_MINUTES = 15;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly queue: SessionQueue,
    private readonly goalLog: GoalLogService,
    private readonly push: PushService,
  ) {}

  /**
   * Re-queues goals that are active but have nothing left to run them.
   *
   * Safe to run repeatedly: the dispatch lease decides which iteration job
   * survives, so a goal that was only briefly idle sees the duplicate stand
   * down rather than dispatching a second specialist.
   */
  async recoverStalledGoals(now = new Date()): Promise<number> {
    const leaseCutoff = new Date(now.getTime() - LEASE_MINUTES * 60_000);
    const stallCutoff = new Date(now.getTime() - GoalContinuity.STALL_GRACE_MINUTES * 60_000);

    // Live goals are excluded in SQL, before the page limit. Filtering after it
    // meant a couple of hundred long-parked goals could occupy the page every
    // pass and hide a genuinely stalled one behind them forever. Ordered by
    // `updatedAt` so the most neglected goal is always in the page.
    const candidates = await this.db
      .select({ id: goals.id, title: goals.title, updatedAt: goals.updatedAt })
      .from(goals)
      .where(
        and(
          eq(goals.status, "active"),
          eq(goals.dodApproved, true),
          lt(goals.updatedAt, stallCutoff),
          // A lease that is still being renewed means a dispatch is alive.
          or(isNull(goals.dispatchLeaseAt), lt(goals.dispatchLeaseAt, leaseCutoff)),
          sql`not exists (
            select 1 from ${sessions}
            where ${sessions.goalId} = ${goals.id}
              and (
                ${sessions.status} = 'waiting-inbox'
                or (${sessions.status} in ('starting', 'running', 'committing')
                    and ${sessions.startedAt} >= ${leaseCutoff.toISOString()}::timestamptz)
              )
          )`,
        ),
      )
      .orderBy(asc(goals.updatedAt))
      .limit(50);

    let recovered = 0;
    for (const goal of candidates) {
      await this.goalLog.appendProgress(
        goal.id,
        "orchestrator",
        "this goal had no iteration queued and no session running; restarting the loop",
      );
      // Keyed by the goal *and the stalled state we observed*, so two
      // overlapping passes collapse to one job while a later, genuinely new
      // stall still gets a job of its own.
      //
      // A key of just the goal id was a permanent wedge: BullMQ treats an
      // existing job with that id as a duplicate even after it has completed,
      // and completed jobs are retained (`removeOnComplete: 500`). On a
      // single-operator install that first recovery job can sit in Redis for
      // months, so every later recovery of the same goal silently returned it
      // and created no runnable work at all — while maintenance logged the goal
      // as recovered.
      await this.queue.enqueueGoalIteration(
        goal.id,
        `goal-recovery-${goal.id}-${goal.updatedAt.getTime()}`,
      );
      this.logger.warn(`re-queued stalled goal "${goal.title}"`);
      recovered += 1;
    }
    return recovered;
  }

  /**
   * Stops a goal whose specialist was reaped holding an unanswered question.
   *
   * Resuming is not available — the container that held the question is gone,
   * and the answer it was waiting for never arrived. Continuing regardless
   * would dispatch the next specialist past a decision the operator declined
   * to make. Stopping says so, once, where they will see it.
   */
  async abandonAfterReap(goalId: string, reason: string, costUsd: number | null): Promise<void> {
    if (costUsd !== null) {
      await this.goalLog.recordSpend(goalId, costUsd);
    }
    const stopped = `stopped: a specialist's question went unanswered — ${reason}`;
    const rows = await this.db
      .update(goals)
      .set({ status: "stopped-stuck", stoppedReason: stopped, updatedAt: new Date() })
      .where(and(eq(goals.id, goalId), eq(goals.status, "active")))
      .returning({ title: goals.title });

    const goal = rows[0];
    if (!goal) {
      // Already completed, paused, or stopped by a rail. Nothing to announce.
      return;
    }
    await this.goalLog.appendProgress(goalId, "orchestrator", stopped);
    await this.push.send({ title: `Goal stopped: ${goal.title}`, body: stopped, url: "/goals" });
  }

}
