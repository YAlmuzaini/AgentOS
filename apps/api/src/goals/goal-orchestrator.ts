import { agents, type Database } from "@agentos/db";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DATABASE } from "../db/db.module";
import { PushService } from "../push/push.service";
import { SessionQueue } from "../queue/session.queue";
import { SessionOrchestrator } from "../runner/session-orchestrator";
import { GOAL_EVALUATOR, type GoalEvaluator } from "./goal-evaluator";
import { DispatchLease } from "./dispatch-lease";
import { GoalLeases } from "./goal-leases";
import { GoalLogService } from "./goal-log.service";
import { type GoalRow, GoalsService } from "./goals.service";

/**
 * The gauntlet loop (SPEC §11).
 *
 * One iteration = evaluate, then dispatch one specialist, then queue the next
 * iteration. The rails are checked *before* every dispatch, so a goal can
 * never exceed them by one more session, and the loop is re-entrant: each
 * iteration is its own queue job, so a crash resumes rather than restarts.
 */
@Injectable()
export class GoalOrchestrator {
  private readonly logger = new Logger(GoalOrchestrator.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly goals: GoalsService,
    private readonly leases: GoalLeases,
    private readonly goalLog: GoalLogService,
    private readonly sessions: SessionOrchestrator,
    private readonly queue: SessionQueue,
    private readonly push: PushService,
    @Inject(GOAL_EVALUATOR) private readonly evaluator: GoalEvaluator,
  ) {}

  async runIteration(goalId: string): Promise<void> {
    // One dispatch at a time, whatever the queue delivered. A duplicate job —
    // two approvals racing, a retry, an operator clicking twice — loses here
    // rather than spending the cap twice.
    const token = await this.goals.claimIteration(goalId);
    if (!token) {
      this.logger.log(`goal ${goalId} is already dispatching; this iteration stands down`);
      return;
    }
    // Held for the length of this dispatch, renewed while it runs, and
    // revoked if another dispatch takes the goal's turn (see DispatchLease).
    const lease = new DispatchLease(this.leases, goalId, token, this.logger);

    let queueNext = false;
    try {
      queueNext = await this.runClaimedIteration(goalId, lease.signal);
    } finally {
      await lease.release();
    }

    // After the release, never before. A successor enqueued while this job
    // still held the slot could be picked up by another free worker, lose the
    // claim, and exit — leaving the goal with nothing queued at all until
    // recovery noticed fifteen minutes later.
    if (queueNext) {
      await this.queue.enqueueGoalIteration(goalId);
    }
  }

  private async runClaimedIteration(goalId: string, revoked: AbortSignal): Promise<boolean> {
    let goal = await this.goals.requireById(goalId);

    if (goal.status !== "active") {
      this.logger.log(`goal ${goalId} is ${goal.status}; not dispatching`);
      return false;
    }
    if (!goal.dodApproved) {
      // SPEC §22.10: the loop does not start before the operator signs off.
      this.logger.warn(`goal ${goalId} has no approved definition of done`);
      return false;
    }

    const breach = this.goals.checkRails(goal);
    if (breach) {
      await this.stop(goal, breach.status, breach.reason);
      return false;
    }

    // Sampled before the evaluator ticks anything. Taking it after meant a
    // checklist item flipping to done — the strongest progress signal there
    // is — landed on the wrong side of the comparison and never reset the
    // stuck counter.
    const marksBefore = goal.progressMarks;
    const allowedAgents = await this.allowedAgents(goal.projectId);
    const decision = await this.evaluator.evaluate({
      title: goal.title,
      spec: goal.spec,
      definitionOfDone: goal.definitionOfDone,
      progressLog: goal.progressLog,
      lastSessionSummary: lastSummary(goal.progressLog),
      allowedAgents,
    });

    goal = await this.goals.markSatisfied(goalId, decision.satisfiedIds);
    const outstanding = goal.definitionOfDone.filter((item) => !item.done);

    // The persisted checklist decides, not the evaluator's own verdict. The
    // evaluator reads the progress log, and the progress log is written by
    // agents — a prompt-injected specialist that writes "the goal is complete"
    // could otherwise close a goal with every box still unticked.
    if (outstanding.length === 0) {
      await this.goalLog.appendProgress(goalId, "orchestrator", "every checkbox is satisfied");
      await this.goals.setStatus(goalId, "completed", null);
      await this.push.send({
        title: "Goal complete",
        body: goal.title,
        url: "/goals",
      });
      return false;
    }

    if (decision.complete) {
      await this.goalLog.appendProgress(
        goalId,
        "orchestrator",
        `the evaluator called this complete while ${outstanding.length} checklist item(s) are ` +
          "still unticked; continuing until they are",
      );
    }

    if (!decision.nextAgent) {
      // The evaluator declined to choose, or chose an agent outside the allow
      // list. Either way this is a stop, not a silent retry.
      await this.stop(
        goal,
        "stopped-stuck",
        `orchestrator had no next specialist to dispatch: ${decision.reasoning}`,
      );
      return false;
    }

    return this.dispatch(goal, decision.nextAgent, decision.brief, marksBefore, revoked);
  }

  private async dispatch(
    goal: GoalRow,
    agentName: string,
    brief: string,
    marksBefore: number,
    revoked: AbortSignal,
  ): Promise<boolean> {
    await this.goalLog.appendProgress(goal.id, "orchestrator", `dispatching ${agentName}: ${brief}`);
    // The slot is consumed before the container exists, not after it returns.
    // Counting on the way out meant a worker that died mid-specialist launched
    // one without spending an iteration, so repeated crashes could start far
    // more than the ceiling allows.
    await this.goals.reserveIteration(goal.id, agentName);

    const result = await this.sessions.runGoalStep({
      goalId: goal.id,
      projectId: goal.projectId,
      agentName,
      brief: renderBrief(goal, brief),
      budgetUsd: remainingBudget(goal),
      runnerPreference: goal.runnerPreference as "cloud" | "local" | "auto",
      // The time rail used to be checked only *before* a dispatch, so a goal
      // with four minutes left could start a specialist that ran for hours.
      deadlineAt: deadline(goal),
      // Stops this specialist if the goal's dispatch slot changes hands.
      signal: revoked,
    });

    if (result.summary.trim()) {
      await this.goalLog.appendProgress(goal.id, agentName, result.summary);
    }
    // Recorded even when the session failed. A failed specialist has usually
    // already spent money, and booking $0 for it meant the next iteration
    // re-read the full remaining budget — a repeatable failure could spend the
    // cap over and over without the cap ever noticing.
    if (result.costUsd !== null) {
      await this.goalLog.recordSpend(goal.id, result.costUsd);
    }

    const after = await this.goals.requireById(goal.id);
    // Counted, not inferred from the log's length: log growth was satisfied by
    // any text at all — the specialist's own prose, or the failure summary of a
    // session that achieved nothing — so a goal could circle forever without
    // the stuck rail firing.
    const madeProgress = after.progressMarks > marksBefore;
    // The row the increment itself returned, so the rails are checked against
    // the state this dispatch actually produced rather than a later read that
    // a concurrent dispatch may have moved again. A parked turn is counted too:
    // a specialist that only ever asks questions is exactly what the stuck rail
    // is for.
    const refreshed = await this.goals.recordProgress(goal.id, madeProgress);

    // A parked specialist has not finished its turn — it is holding a container
    // and waiting on the operator. The loop stops here rather than dispatching
    // someone else alongside it; answering the question is what starts the next
    // turn, and the reaper stops the goal if the answer never comes.
    if (result.parked) {
      await this.goalLog.appendProgress(
        goal.id,
        "orchestrator",
        `${agentName} is waiting on your answer in the inbox; the goal continues when you reply`,
      );
      return false;
    }

    // Re-check the rails now rather than at the top of the next iteration:
    // spend and the stuck counter only move here, and queueing another turn we
    // already know is over-budget wastes a container.
    if (refreshed.status !== "active") {
      return false;
    }
    const breach = this.goals.checkRails(refreshed);
    if (breach) {
      await this.stop(refreshed, breach.status, breach.reason);
      return false;
    }
    return true;
  }

  private async stop(goal: GoalRow, status: GoalRow["status"], reason: string): Promise<void> {
    this.logger.warn(`goal ${goal.id} stopped (${status}): ${reason}`);
    await this.goalLog.appendProgress(goal.id, "orchestrator", `stopped: ${reason}`);
    await this.goals.setStatus(goal.id, status as never, reason);
    await this.push.send({ title: `Goal stopped: ${goal.title}`, body: reason, url: "/goals" });
  }

  /** SPEC §22.14: dispatch is limited to this project's own agents. */
  private async allowedAgents(projectId: string): Promise<string[]> {
    const rows = await this.db
      .select({ name: agents.name })
      .from(agents)
      .where(eq(agents.projectId, projectId));
    return rows.map((row) => row.name);
  }
}

/**
 * When this goal's time rail runs out, in wall clock.
 *
 * Handed to the session so a specialist started just inside the limit is cut
 * off at it rather than running until it feels finished.
 */
function deadline(goal: GoalRow): Date | null {
  if (goal.maxDurationMinutes === null || !goal.startedAt) {
    return null;
  }
  return new Date(goal.startedAt.getTime() + goal.maxDurationMinutes * 60_000);
}

/** The remaining cap, so one runaway session cannot blow the whole budget. */
function remainingBudget(goal: GoalRow): number | null {
  if (goal.spendCapUsd === null) {
    return null;
  }
  return Math.max(0, Number(goal.spendCapUsd) - Number(goal.spendUsd));
}

function renderBrief(goal: GoalRow, brief: string): string {
  const outstanding = goal.definitionOfDone
    .filter((item) => !item.done)
    .map((item) => `- ${item.text}`)
    .join("\n");

  return [
    `Goal: ${goal.title}`,
    "",
    brief,
    "",
    "# Still outstanding",
    outstanding || "(nothing)",
    "",
    "# Progress so far",
    goal.progressLog.trim() || "(nothing yet)",
    "",
    "Record what you did with agentos_add_activity before you finish — the next " +
      "specialist and the orchestrator both read it.",
  ].join("\n");
}

function lastSummary(progressLog: string): string {
  const entries = progressLog.trim().split("\n").filter(Boolean);
  return entries.slice(-6).join("\n");
}
