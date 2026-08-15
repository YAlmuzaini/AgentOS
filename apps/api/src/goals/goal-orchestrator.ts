import { agents, type Database } from "@agentos/db";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DATABASE } from "../db/db.module";
import { PushService } from "../push/push.service";
import { SessionQueue } from "../queue/session.queue";
import { SessionOrchestrator } from "../runner/session-orchestrator";
import { GOAL_EVALUATOR, type GoalEvaluator } from "./goal-evaluator";
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
    if (!(await this.goals.claimIteration(goalId))) {
      this.logger.log(`goal ${goalId} is already dispatching; this iteration stands down`);
      return;
    }
    try {
      await this.runClaimedIteration(goalId);
    } finally {
      await this.goals.releaseIteration(goalId);
    }
  }

  private async runClaimedIteration(goalId: string): Promise<void> {
    let goal = await this.goals.requireById(goalId);

    if (goal.status !== "active") {
      this.logger.log(`goal ${goalId} is ${goal.status}; not dispatching`);
      return;
    }
    if (!goal.dodApproved) {
      // SPEC §22.10: the loop does not start before the operator signs off.
      this.logger.warn(`goal ${goalId} has no approved definition of done`);
      return;
    }

    const breach = this.goals.checkRails(goal);
    if (breach) {
      await this.stop(goal, breach.status, breach.reason);
      return;
    }

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

    if (decision.complete || outstanding.length === 0) {
      await this.goalLog.appendProgress(goalId, "orchestrator", "every checkbox is satisfied");
      await this.goals.setStatus(goalId, "completed", null);
      await this.push.send({
        title: "Goal complete",
        body: goal.title,
        url: "/goals",
      });
      return;
    }

    if (!decision.nextAgent) {
      // The evaluator declined to choose, or chose an agent outside the allow
      // list. Either way this is a stop, not a silent retry.
      await this.stop(
        goal,
        "stopped-stuck",
        `orchestrator had no next specialist to dispatch: ${decision.reasoning}`,
      );
      return;
    }

    await this.dispatch(goal, decision.nextAgent, decision.brief);
  }

  private async dispatch(goal: GoalRow, agentName: string, brief: string): Promise<void> {
    await this.goalLog.appendProgress(goal.id, "orchestrator", `dispatching ${agentName}: ${brief}`);
    // Measured after the dispatch line is written rather than estimated from
    // its parts: the stuck rail is what stops a goal burning money in a circle,
    // and it should not depend on guessing how long a log prefix is.
    const before = (await this.goals.requireById(goal.id)).progressLog.length;

    const result = await this.sessions.runGoalStep({
      goalId: goal.id,
      projectId: goal.projectId,
      agentName,
      brief: renderBrief(goal, brief),
      budgetUsd: remainingBudget(goal),
      runnerPreference: goal.runnerPreference as "cloud" | "local" | "auto",
    });

    if (result.summary.trim()) {
      await this.goalLog.appendProgress(goal.id, agentName, result.summary);
    }
    if (result.costUsd !== null) {
      await this.goalLog.recordSpend(goal.id, result.costUsd);
    }

    // A parked specialist has not finished its turn — it is holding a container
    // and waiting on the operator. The loop stops here rather than counting an
    // iteration and dispatching someone else alongside it; answering the
    // question is what starts the next turn.
    if (result.parked) {
      await this.goalLog.appendProgress(
        goal.id,
        "orchestrator",
        `${agentName} is waiting on your answer in the inbox; the goal continues when you reply`,
      );
      return;
    }

    const after = await this.goals.requireById(goal.id);
    // "Progress" is anything the specialist added to the shared log — its own
    // summary, or an activity it recorded. An agent that ran and wrote nothing
    // counts as a stuck iteration.
    const madeProgress = after.progressLog.length > before;
    // The row the increment itself returned, so the rails are checked against
    // the state this dispatch actually produced rather than a later read that
    // a concurrent dispatch may have moved again.
    const refreshed = await this.goals.recordIteration(goal.id, { agentName, madeProgress });

    // Re-check the rails now rather than at the top of the next iteration:
    // spend and the stuck counter only move here, and queueing another turn we
    // already know is over-budget wastes a container.
    if (refreshed.status !== "active") {
      return;
    }
    const breach = this.goals.checkRails(refreshed);
    if (breach) {
      await this.stop(refreshed, breach.status, breach.reason);
      return;
    }
    await this.queue.enqueueGoalIteration(goal.id);
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
