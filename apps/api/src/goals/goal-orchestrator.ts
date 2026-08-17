import { Inject, Injectable, Logger } from "@nestjs/common";
import { PushService } from "../push/push.service";
import { CapabilityService } from "../capabilities/capability.service";
import { SessionQueue } from "../queue/session.queue";
import { LocalDecisionUnavailableError } from "../runner/local-runner";
import { SessionOrchestrator } from "../runner/session-orchestrator";
import { GOAL_EVALUATOR, type GoalEvaluation, type GoalEvaluator } from "./goal-evaluator";
import { DispatchLease } from "./dispatch-lease";
import { GoalLeases } from "./goal-leases";
import { GoalLogService } from "./goal-log.service";
import { type GoalRow, GoalsService } from "./goals.service";
import { MAX_ITERATIONS, MAX_UNAVAILABLE_TURNS } from "./goal-rails";
import { GoalRuns } from "./goal-runs";
import { HandoffsService } from "../handoffs/handoffs.service";

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
    private readonly goals: GoalsService,
    private readonly leases: GoalLeases,
    private readonly goalLog: GoalLogService,
    private readonly sessions: SessionOrchestrator,
    private readonly queue: SessionQueue,
    private readonly push: PushService,
    private readonly capabilities: CapabilityService,
    private readonly runs: GoalRuns,
    private readonly handoffs: HandoffsService,
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
    const run = this.runs.begin(goalId, lease.signal);

    let queueNext = false;
    try {
      queueNext = await this.runClaimedIteration(goalId, run.signal);
    } finally {
      run.release();
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
    // The same resolved requirements preflight uses. An agent that lacks the
    // goal's required repository, environment or connection is not offered:
    // "ready" alone would put the support agent on a repository goal.
    // Wrapped for the same reason the evaluator below is: a turn that ends
    // without settling leaves the stuck counter where it was, and a goal whose
    // counter never moves is one the continuity sweep re-queues indefinitely.
    // This call spends nothing, but the shape is the defect, not the cost.
    let eligibleAgents;
    try {
      ({ eligible: eligibleAgents } = await this.capabilities.roster(
        goal.projectId,
        goal.runnerPreference as "cloud" | "local" | "auto",
      ));
    } catch (error) {
      this.logger.error(`goal ${goalId}: could not read the capability roster: ${String(error)}`);
      await this.goalLog.appendProgress(
        goalId,
        "orchestrator",
        `could not read the fleet this turn (${errorLabel(error)}); counting it as a turn without progress`,
      );
      await this.settleTurn(goalId, marksBefore);
      return false;
    }
    if (eligibleAgents.length === 0) {
      await this.stop(
        goal,
        "stopped-stuck",
        "no installed agent is ready, granted the goal's required resources, and able to run " +
          "under this goal's execution profile",
      );
      return false;
    }
    // A failed decision is a turn that achieved nothing — booked as one rather
    // than thrown.
    //
    // Letting it propagate was the worst shape in the loop. The throw escaped
    // before `reserveIteration` and before `recordProgress`, so neither the
    // iteration ceiling nor the stuck counter moved; the queue job died; and
    // the continuity sweep re-queued the goal every quarter of an hour,
    // for ever, making a fresh metered evaluator call each pass. The failures
    // that matter here are not all transient — an evaluator that keeps naming
    // an ineligible agent fails identically every time — so "retry until
    // something changes" is a loop with no exit.
    //
    // Recording no progress gives it one: each failed pass advances the stuck
    // counter, and the goal stops itself at the operator's threshold with a
    // reason and a push, instead of spending quietly until someone looks.
    let decision: GoalEvaluation;
    try {
      decision = await this.evaluator.evaluate({
        projectId: goal.projectId,
        goalId: goal.id,
        runnerPreference: goal.runnerPreference as "cloud" | "local" | "auto",
        title: goal.title,
        spec: goal.spec,
        definitionOfDone: goal.definitionOfDone,
        progressLog: goal.progressLog,
        lastSessionSummary: lastSummary(goal.progressLog),
        eligibleAgents,
      });
    } catch (error) {
      // A worker that was *busy* is not a decision that *failed*. It cost
      // nothing, it will very likely succeed later, and counting it against the
      // stuck rail eventually stopped the goal with "no progress" when the
      // truth was "the local worker was saturated". Left for the continuity
      // sweep to pick up, with the real reason in the log.
      if (error instanceof LocalDecisionUnavailableError) {
        this.logger.warn(`goal ${goalId}: ${error.message}`);
        // Waiting is not progress, but it is not failure either, so it gets a
        // rail of its own rather than borrowing the stuck counter — reusing
        // that would re-create the bug this catch exists to fix, where a busy
        // worker eventually stopped the goal with "no progress".
        //
        // The counter is durable and already written: consecutive
        // `unavailable` decision audit rows since the last successful one. A
        // goal may therefore wait a long time for a worker to come back, and
        // then stops itself with the true reason instead of spinning silently
        // for ever — which is what "goals have rails" has to mean on this path
        // too.
        const waited = await this.goals.consecutiveUnavailableDecisions(goalId);
        if (waited >= MAX_UNAVAILABLE_TURNS) {
          await this.stop(
            goal,
            "stopped-stuck",
            `the local worker could not take an orchestration decision for ${waited} consecutive ` +
              "turns" +
              // Only claim this when it is true: an `auto` goal can reach the
              // ceiling too, if every health check lands in a free window and
              // every decision lands in a full one.
              (goal.runnerPreference === "local"
                ? ", and the goal was not sent to the cloud because it is pinned to local"
                : "") +
              ". A stopped goal cannot be restarted; start or undrain the worker, then create a " +
              "new goal for the outstanding checklist. The progress log is kept.",
          );
          return false;
        }
        await this.goalLog.appendProgress(
          goalId,
          "orchestrator",
          `the local worker could not take this turn's decision (${waited} of ` +
            `${MAX_UNAVAILABLE_TURNS} consecutive). The goal is unchanged and will be retried; ` +
            "this does not count against the stuck rail.",
        );
        return false;
      }
      this.logger.error(`goal ${goalId}: the orchestrator could not decide this turn: ${String(error)}`);
      await this.goalLog.appendProgress(
        goalId,
        "orchestrator",
        `could not decide this turn (${errorLabel(error)}); counting it as a turn without progress`,
      );
      await this.settleTurn(goalId, marksBefore);
      return false;
    }

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

    const dispatches = [
      { agent: decision.nextAgent, brief: decision.brief },
      ...(decision.parallelAgents ?? []),
    ].slice(0, Math.max(0, MAX_ITERATIONS - goal.iterations));
    if (dispatches.length === 0) {
      await this.stop(goal, "stopped-stuck", `reached the hard ceiling of ${MAX_ITERATIONS} iterations`);
      return false;
    }
    const budgetEach = divideBudget(remainingBudget(goal), dispatches.length);
    // `allSettled`, not `all`. A rejection from one child — the agent was
    // deleted mid-goal, the pinned local worker rebooted, a database call
    // failed — used to abandon the whole turn's bookkeeping, so siblings that
    // had genuinely finished were never accounted for while they went on
    // writing spend and handoffs into a turn nobody would settle.
    const settled = await Promise.allSettled(
      dispatches.map((dispatch) =>
        this.dispatch(goal, dispatch.agent, dispatch.brief, revoked, budgetEach),
      ),
    );
    const results = settled.flatMap((entry) => (entry.status === "fulfilled" ? [entry.value] : []));
    const rejected = settled.filter((entry) => entry.status === "rejected");
    for (const entry of rejected) {
      const reason = (entry as PromiseRejectedResult).reason as unknown;
      this.logger.error(`goal ${goalId}: a specialist could not be dispatched: ${String(reason)}`);
      await this.goalLog.appendProgress(
        goalId,
        "orchestrator",
        `a specialist could not be dispatched (${errorLabel(reason)})`,
      );
    }

    // Progress accounting is per *turn*, not per child, and this is the only
    // place it is recorded.
    //
    // Asking each child independently gave every sibling the same turn-level
    // answer while incrementing the stuck counter once per child, which made a
    // fruitless four-way fan-out trip the stuck rail four times faster than a
    // fruitless single dispatch. One turn, one mark.
    //
    // `progressMarks` is bumped by `markSatisfied` above and also by the
    // agent-facing `agentos_add_activity` / task-update tools, so a specialist
    // can reset the stuck counter by reporting activity. That is the existing
    // documented behaviour of the stuck rail, not something this accounting
    // introduces — but it does mean any one child of a fan-out can clear the
    // counter for the whole turn.
    const stillRunning = await this.settleTurn(goalId, marksBefore);
    if (!stillRunning) return false;

    if (results.some((result) => result.parked)) {
      // A parked specialist is holding a container and waiting on the operator.
      // Answering is what starts the next turn; the reaper stops the goal if
      // the answer never comes.
      await this.goalLog.appendProgress(
        goalId,
        "orchestrator",
        `${results.filter((result) => result.parked).map((result) => result.agentName).join(", ")} ` +
          "is waiting on your answer in the inbox; the goal continues when you reply",
      );
      return false;
    }
    return rejected.length === 0 && results.every((result) => result.dispatched);
  }

  /**
   * Closes one turn: record whether it moved the goal, then re-check the rails.
   *
   * Every path out of a claimed iteration that got as far as deciding runs
   * through here, including the ones that failed. That is the point — a turn
   * that ends without settling leaves the stuck counter where it was, and a
   * goal whose counter never moves is a goal the continuity sweep re-queues
   * for ever.
   *
   * Returns the goal when it is still active and within its rails, or `null`
   * when this turn was the last one.
   */
  private async settleTurn(goalId: string, marksBefore: number): Promise<GoalRow | null> {
    // The operator can pause and delete a goal while its dispatch is running —
    // `dispatch` guards the same race before provisioning. Without this, the
    // settle step threw *after* money had been spent and a handoff written, and
    // the only record was a line in the queue log.
    if (!(await this.goals.exists(goalId))) {
      this.logger.log(`goal ${goalId} was deleted while this turn ran; nothing to settle`);
      return null;
    }
    const current = await this.goals.requireById(goalId);
    const refreshed = await this.goals.recordProgress(
      goalId,
      current.progressMarks > marksBefore,
    );
    if (refreshed.status !== "active") return null;
    const breach = this.goals.checkRails(refreshed);
    if (breach) {
      await this.stop(refreshed, breach.status, breach.reason);
      return null;
    }
    return refreshed;
  }

  /** Runs one specialist. Progress and rails are settled by the caller, once
   * for the whole turn — see `runClaimedIteration`. */
  private async dispatch(
    goal: GoalRow,
    agentName: string,
    brief: string,
    revoked: AbortSignal,
    budgetUsd: number | null,
  ): Promise<{ agentName: string; dispatched: boolean; parked: boolean }> {
    await this.goalLog.appendProgress(goal.id, "orchestrator", `dispatching ${agentName}: ${brief}`);
    // The slot is consumed before the container exists, not after it returns.
    // Counting on the way out meant a worker that died mid-specialist launched
    // one without spending an iteration, so repeated crashes could start far
    // more than the ceiling allows.
    await this.goals.reserveIteration(goal.id, agentName);

    // Re-read immediately before the container exists. This turn checked the
    // goal was active several awaits ago; an operator can pause and delete it
    // in that window, and `sessions.goal_id` has no foreign key to stop the
    // session being created against a goal that is gone — it would run, spend,
    // and fail at the end trying to update nothing. The reservation above is
    // already recorded, so the cost of losing this race is one unused
    // iteration slot on a goal that no longer exists.
    if (!(await this.goals.exists(goal.id))) {
      await this.goalLog.appendProgress(
        goal.id,
        "orchestrator",
        `${agentName} was not dispatched: the goal was deleted while this turn was deciding`,
      );
      return { agentName, dispatched: false, parked: false };
    }

    const result = await this.sessions.runGoalStep({
      goalId: goal.id,
      projectId: goal.projectId,
      agentName,
      brief: renderBrief(goal, brief),
      budgetUsd,
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
    // Bookkeeping, not the work. A handoff that cannot be written is worth a
    // line in the log; it is not worth failing a turn that has already run and
    // already spent money. Throwing here skipped `recordProgress` below, so the
    // stuck rail never advanced and the goal re-ran the same failing turn until
    // a spend cap or the iteration ceiling caught it.
    try {
      await this.handoffs.ensureForSession(
        result.sessionId,
        result.summary.trim() || `${agentName} finished without a narrative summary.`,
      );
    } catch (error) {
      this.logger.error(
        `goal ${goal.id}: could not record ${agentName}'s handoff: ${String(error)}`,
      );
    }
    // Recorded even when the session failed. A failed specialist has usually
    // already spent money, and booking $0 for it meant the next iteration
    // re-read the full remaining budget — a repeatable failure could spend the
    // cap over and over without the cap ever noticing.
    if (result.costUsd !== null) {
      await this.goalLog.recordSpend(goal.id, result.costUsd);
    }

    return { agentName, dispatched: !result.parked, parked: result.parked };
  }

  /**
   * Stops the goal, at most once.
   *
   * The status change is a claim on an `active` row, so a rail breached by two
   * concurrent paths produces one stop, one log line and one push — not one of
   * each per breach. A loser here simply returns.
   */
  private async stop(goal: GoalRow, status: GoalRow["status"], reason: string): Promise<void> {
    const stopped = await this.goals.stopIfActive(goal.id, status as never, reason);
    if (!stopped) {
      this.logger.log(`goal ${goal.id} was already stopped; not reporting "${reason}" again`);
      return;
    }
    this.logger.warn(`goal ${goal.id} stopped (${status}): ${reason}`);
    await this.goalLog.appendProgress(goal.id, "orchestrator", `stopped: ${reason}`);
    await this.push.send({ title: `Goal stopped: ${goal.title}`, body: reason, url: "/goals" });
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

function divideBudget(remaining: number | null, count: number): number | null {
  return remaining === null ? null : Math.max(0, remaining / Math.max(1, count));
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

/** A short, non-secret label for a failure written into the progress log. */
function errorLabel(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`.slice(0, 300);
  return String(error).slice(0, 300);
}

function lastSummary(progressLog: string): string {
  const entries = progressLog.trim().split("\n").filter(Boolean);
  return entries.slice(-6).join("\n");
}
