import { goals as goalsTable } from "@agentos/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GOAL_EVALUATOR, type GoalEvaluation, type GoalEvaluator } from "../src/goals/goal-evaluator";
import { GoalOrchestrator } from "../src/goals/goal-orchestrator";
import { GoalsService } from "../src/goals/goals.service";
import { MAX_ITERATIONS } from "../src/goals/goal-rails";
import { InboxService } from "../src/inbox/inbox.service";
import { SessionOrchestrator } from "../src/runner/session-orchestrator";
import { SessionsService } from "../src/sessions/sessions.service";
import { createHarness, type Harness } from "./harness";
import { stubQueue, type QueueSink } from "./queue-stub";

/**
 * Round-six findings — mostly defects inside round five's own fixes.
 *
 * The headline one: the deadline added in round five could not actually stop a
 * silent session, because it worked by abandoning the iterator. Calling
 * `return()` on an async generator blocked inside `next()` queues behind that
 * read rather than interrupting it, so the one case a deadline exists for was
 * the one case it hung on. Cancellation now reaches the request.
 */
class ScriptedEvaluator implements GoalEvaluator {
  queue: GoalEvaluation[] = [];

  async evaluate(): Promise<GoalEvaluation> {
    return (
      this.queue.shift() ?? {
        satisfiedIds: [],
        nextAgent: "senior-dev",
        brief: "keep going",
        complete: false,
        reasoning: "",
      }
    );
  }
}

describe("round six", () => {
  let harness: Harness;
  let goals: GoalsService;
  let orchestrator: GoalOrchestrator;
  let sessions: SessionsService;
  let queued: QueueSink;
  const evaluator = new ScriptedEvaluator();

  beforeAll(async () => {
    harness = await createHarness({
      override: (builder) => builder.overrideProvider(GOAL_EVALUATOR).useValue(evaluator),
    });
    goals = harness.app.get(GoalsService);
    orchestrator = harness.app.get(GoalOrchestrator);
    sessions = harness.app.get(SessionsService);
    queued = stubQueue(harness);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    evaluator.queue = [];
    queued.clear();
  });

  async function activeGoal(overrides: Record<string, unknown> = {}) {
    const { projectId } = await harness.seedProject();
    const goal = await goals.create(projectId, {
      title: "Ship onboarding",
      spec: "- the operator can sign in",
      definitionOfDone: [],
      spendCapUsd: 10,
      acknowledgeNoSpendCap: false,
      maxDurationMinutes: null,
      stuckThreshold: 19,
      runnerPreference: "auto",
      ...overrides,
    } as never);
    await goals.approveDod(projectId, goal.id, { definitionOfDone: goal.definitionOfDone });
    queued.clear();
    return { projectId, goalId: goal.id };
  }

  /**
   * The test round five should have had. Its stream resolved after ten seconds,
   * so the deadline appeared to work when it was really the timer ending the
   * run. This one never resolves at all.
   */
  it("cuts off a session that has gone completely silent", async () => {
    const { projectId, goalId } = await activeGoal({ maxDurationMinutes: 60 });
    await harness.db
      .update(goalsTable)
      .set({ startedAt: new Date(Date.now() - (60 * 60_000 - 1_500)) })
      .where(eq(goalsTable.id, goalId));
    harness.runner.hangNextStream();

    // If cancellation does not reach the stream, this never returns and the
    // test times out — which is exactly the production symptom.
    await orchestrator.runIteration(goalId);

    const [session] = await sessions.list();
    expect(session!.status).toBe("failed");
    expect(session!.error).toContain("time limit ran out");
    // The container was freed rather than left billing behind a hung consumer.
    expect(harness.runner.destroyed).toContain(session!.runtimeHandle);
    expect((await goals.get(projectId, goalId)).status).toBe("stopped-time");
  }, 30_000);

  /**
   * Losing the dispatch lease has to stop the specialist, not just be logged.
   * Whoever holds the lease owns the remaining budget; a previous holder still
   * running beside them is the double-spend the lease exists to prevent.
   *
   * Driven through the signal itself rather than the five-minute renewal timer:
   * the behaviour under test is that revocation reaches the running session.
   */
  it("stops a specialist whose goal handed its turn to another dispatch", async () => {
    const { projectId, goalId } = await activeGoal();
    const revoked = new AbortController();
    harness.runner.hangNextStream();

    const running = harness.app.get(SessionOrchestrator).runGoalStep({
      goalId,
      projectId,
      agentName: "senior-dev",
      brief: "do the thing",
      budgetUsd: 10,
      signal: revoked.signal,
    });

    // Let it provision and start streaming, then take its turn away.
    await new Promise((resolve) => setTimeout(resolve, 200));
    revoked.abort();
    const result = await running;

    expect(result.parked).toBe(false);
    const [session] = await sessions.list();
    expect(session!.status).toBe("failed");
    expect(session!.error).toContain("handed its turn");
    // The container was freed rather than left running beside its replacement.
    expect(harness.runner.destroyed).toContain(session!.runtimeHandle);
  }, 30_000);

  /** A failed *resumed* turn spent money too. Round five only charged the first half. */
  it("charges the goal when a resumed session fails", async () => {
    const { projectId, goalId } = await activeGoal();
    harness.runner.setScript([
      {
        kind: "tool",
        call: {
          name: "inbox_ask",
          input: {
            question: "Which database?",
            choices: [
              { id: "pg", label: "Postgres" },
              { id: "sqlite", label: "SQLite" },
            ],
          },
        },
      },
    ]);
    await orchestrator.runIteration(goalId);
    const spentAfterPark = (await goals.get(projectId, goalId)).spendUsd;

    const [parked] = await sessions.list();
    const inbox = harness.app.get(InboxService);
    const message = (await inbox.list(undefined, "open"))[0]!;
    await inbox.reply(message.id, { selectedChoiceId: "pg", body: null });

    // The resumed half fails after the answer lands.
    harness.runner.failNextStream(new Error("the event stream dropped"));
    await harness.app.get(SessionOrchestrator).resumeSession(parked!.id, message.id);

    const after = await goals.get(projectId, goalId);
    expect(after.spendUsd).toBeGreaterThan(spentAfterPark);
    // And the loop was handed back rather than left with nothing queued.
    expect(queued.goalIterations).toContain(goalId);
  }, 30_000);

  /**
   * Self-attested progress is not evidence. An injected agent can call its
   * activity tool with any text at all, so there has to be one ceiling that
   * counts dispatches and nothing else.
   */
  it("stops a goal at the hard iteration ceiling however much progress it claims", async () => {
    const { projectId, goalId } = await activeGoal();
    await harness.db
      .update(goalsTable)
      // One short of the ceiling, with the adaptive rail fully reset — exactly
      // what an agent minting a progress mark every turn would produce.
      .set({ iterations: MAX_ITERATIONS - 1, stuckCount: 0, progressMarks: 500 })
      .where(eq(goalsTable.id, goalId));

    harness.runner.setScript([
      { kind: "tool", call: { name: "agentos_add_activity", input: { note: "still working" } } },
    ]);
    await orchestrator.runIteration(goalId);
    // That turn takes it to the ceiling; the next refuses to dispatch.
    await orchestrator.runIteration(goalId);

    const after = await goals.get(projectId, goalId);
    expect(after.status).toBe("stopped-stuck");
    expect(after.stoppedReason).toContain("hard ceiling");
  }, 30_000);

  /** Alternating specialists used to reset the stuck counter every turn. */
  it("does not reset the stuck rail just because the specialist changed", async () => {
    const { projectId, goalId } = await activeGoal({ stuckThreshold: 2 });

    for (const agentName of ["senior-dev", "plan", "senior-dev"]) {
      evaluator.queue.push({
        satisfiedIds: [],
        nextAgent: agentName,
        brief: "try again",
        complete: false,
        reasoning: "",
      });
      harness.runner.setScript([]);
      await orchestrator.runIteration(goalId);
    }

    expect((await goals.get(projectId, goalId)).status).toBe("stopped-stuck");
  }, 30_000);
});
