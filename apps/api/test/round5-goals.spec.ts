import { goals as goalsTable } from "@agentos/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GOAL_EVALUATOR, type GoalEvaluation, type GoalEvaluator } from "../src/goals/goal-evaluator";
import { GoalOrchestrator } from "../src/goals/goal-orchestrator";
import { GoalsService } from "../src/goals/goals.service";
import { SessionsService } from "../src/sessions/sessions.service";
import { createHarness, type Harness } from "./harness";
import { stubQueue, type QueueSink } from "./queue-stub";

/**
 * Round-five review findings about the goal loop.
 *
 * Every one of these is a way a goal could burn money, stop counting it, or
 * declare itself finished on something an agent wrote. None of them was
 * reachable by the existing tests, because all of them need a session that
 * fails, or output that looks like work without being work.
 */
class ScriptedEvaluator implements GoalEvaluator {
  queue: GoalEvaluation[] = [];

  async evaluate(): Promise<GoalEvaluation> {
    return (
      this.queue.shift() ?? {
        satisfiedIds: [],
        nextAgent: null,
        brief: "",
        complete: false,
        reasoning: "no script left",
      }
    );
  }
}

describe("goal loop — round five", () => {
  let harness: Harness;
  let goals: GoalsService;
  let orchestrator: GoalOrchestrator;
  let queued: QueueSink;
  const evaluator = new ScriptedEvaluator();

  beforeAll(async () => {
    harness = await createHarness({
      override: (builder) => builder.overrideProvider(GOAL_EVALUATOR).useValue(evaluator),
    });
    goals = harness.app.get(GoalsService);
    orchestrator = harness.app.get(GoalOrchestrator);
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
      spec: "- the operator can sign in\n- the operator sees their tasks",
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

  function dispatch(agentName = "senior-dev"): void {
    evaluator.queue.push({
      satisfiedIds: [],
      nextAgent: agentName,
      brief: "do the thing",
      complete: false,
      reasoning: "",
    });
  }

  /**
   * A specialist that dies after provisioning has usually already spent money.
   * Booking $0 for it meant the next iteration read the full remaining budget
   * again — a repeatable failure could spend the cap many times over while the
   * cap itself read as untouched.
   */
  it("charges the goal for a session that failed after it had already spent", async () => {
    const { projectId, goalId } = await activeGoal();
    dispatch();
    harness.runner.failNextStream(new Error("the event stream dropped"));

    await orchestrator.runIteration(goalId);

    const after = await goals.get(projectId, goalId);
    // The fake runner reports $0.25 for any session it was asked about.
    expect(after.spendUsd).toBeCloseTo(0.25, 4);
    expect(after.progressLog).toContain("session failed");
  });

  /**
   * The stuck rail used to mean "the progress log got longer", and the failure
   * summary above is itself a line in that log. So the rail counted a failing
   * session as progress and reset itself every time.
   */
  it("does not count a specialist's own prose as progress", async () => {
    const { projectId, goalId } = await activeGoal({ stuckThreshold: 2 });

    for (let index = 0; index < 3; index += 1) {
      dispatch();
      // The agent talks, and does nothing else. Chatty is not the same as busy.
      harness.runner.setScript([
        { kind: "log", type: "agent.message", summary: "Working on it, looks promising." },
      ]);
      await orchestrator.runIteration(goalId);
    }

    const after = await goals.get(projectId, goalId);
    expect(after.status).toBe("stopped-stuck");
    expect(after.progressLog).toContain("looks promising");
  });

  /** The other half: a real activity record does reset the rail. */
  it("counts an agent's recorded activity as progress", async () => {
    const { projectId, goalId } = await activeGoal({ stuckThreshold: 2 });

    for (let index = 0; index < 3; index += 1) {
      dispatch();
      harness.runner.setScript([
        { kind: "tool", call: { name: "agentos_add_activity", input: { note: `turn ${index}` } } },
      ]);
      await orchestrator.runIteration(goalId);
    }

    const after = await goals.get(projectId, goalId);
    expect(after.status).toBe("active");
  });

  /**
   * The evaluator reads the progress log, and the progress log is written by
   * agents. A specialist that writes "this goal is finished" must not be able
   * to close a goal with every box still unticked.
   */
  it("refuses to complete a goal the checklist says is unfinished", async () => {
    const { projectId, goalId } = await activeGoal();
    evaluator.queue.push({
      satisfiedIds: [],
      nextAgent: "senior-dev",
      brief: "carry on",
      complete: true,
      reasoning: "an agent said so",
    });
    harness.runner.setScript([]);

    await orchestrator.runIteration(goalId);

    const after = await goals.get(projectId, goalId);
    expect(after.status).toBe("active");
    expect(after.definitionOfDone.every((item) => !item.done)).toBe(true);
    expect(after.progressLog).toContain("still unticked");
  });

  /**
   * A parked turn is a turn. Before this it was not counted at all, so a
   * specialist that only ever asked questions could never trip the rail.
   */
  it("counts a parked turn as an iteration", async () => {
    const { projectId, goalId } = await activeGoal();
    dispatch();
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

    const after = await goals.get(projectId, goalId);
    expect(after.iterations).toBe(1);
    // The loop stops on a park rather than queueing another specialist.
    expect(queued.goalIterations).toEqual([]);
    expect(after.progressLog).toContain("waiting on your answer");
  });

  /**
   * The time rail used to be checked only before a dispatch, so a goal with
   * one minute left could start a specialist that then ran for hours. The
   * deadline now travels into the session and ends it where the rail says.
   */
  it("cuts off a session that outlives the goal's time limit", async () => {
    const { projectId, goalId } = await activeGoal({ maxDurationMinutes: 60 });
    dispatch();
    // Started 59.98 minutes ago: the rail still lets this dispatch through,
    // and roughly a second of the goal's hour remains for it to run in.
    await harness.db
      .update(goalsTable)
      .set({ startedAt: new Date(Date.now() - (60 * 60_000 - 1_200)) })
      .where(eq(goalsTable.id, goalId));
    // An agent that provisions and then simply never stops.
    harness.runner.hangNextStream();

    await orchestrator.runIteration(goalId);

    const [session] = await harness.app.get(SessionsService).list();
    expect(session!.status).toBe("failed");
    expect(session!.error).toContain("time limit ran out");
    // And the container it was holding was freed rather than left running.
    expect(harness.runner.destroyed).toContain(session!.runtimeHandle);

    const after = await goals.get(projectId, goalId);
    expect(after.status).toBe("stopped-time");
  });
});
