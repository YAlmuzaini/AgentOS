import { goals as goalsTable } from "@agentos/db";
import { createGoalSchema } from "@agentos/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GOAL_EVALUATOR, type GoalEvaluation, type GoalEvaluator } from "../src/goals/goal-evaluator";
import { GoalOrchestrator } from "../src/goals/goal-orchestrator";
import { GoalsService } from "../src/goals/goals.service";
import { SessionQueue } from "../src/queue/session.queue";
import { createHarness, type Harness } from "./harness";

/**
 * Phase 4 done-when (SPEC §21) and acceptance tests §22.9, §22.10, §22.14.
 *
 * The evaluator is scripted rather than real: the loop's job is to dispatch,
 * count, and stop, and those are exactly the parts that must not depend on a
 * model's judgement to be correct.
 */
class ScriptedEvaluator implements GoalEvaluator {
  queue: GoalEvaluation[] = [];
  seen: Array<{ allowedAgents: string[] }> = [];

  async evaluate(input: { allowedAgents: string[] }): Promise<GoalEvaluation> {
    this.seen.push({ allowedAgents: input.allowedAgents });
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

describe("goal loop", () => {
  let harness: Harness;
  let goals: GoalsService;
  let orchestrator: GoalOrchestrator;
  const evaluator = new ScriptedEvaluator();
  let iterations: string[];

  beforeAll(async () => {
    harness = await createHarness({
      override: (builder) => builder.overrideProvider(GOAL_EVALUATOR).useValue(evaluator),
    });
    goals = harness.app.get(GoalsService);
    orchestrator = harness.app.get(GoalOrchestrator);

    // Iterations are chained through the queue; record instead of running.
    const queue = harness.app.get(SessionQueue);
    queue.enqueueGoalIteration = async (goalId: string) => {
      iterations.push(goalId);
    };
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    evaluator.queue = [];
    evaluator.seen = [];
    iterations = [];
  });

  async function createGoal(projectId: string, overrides: Record<string, unknown> = {}) {
    return goals.create(projectId, {
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
  }

  it("drafts a checklist from the spec but will not run before approval", async () => {
    const { projectId } = await harness.seedProject();
    const goal = await createGoal(projectId);

    expect(goal.status).toBe("draft");
    expect(goal.dodApproved).toBe(false);
    expect(goal.definitionOfDone.map((item) => item.text)).toEqual([
      "the operator can sign in",
      "the operator sees their tasks",
    ]);

    // §22.10 — nothing spawns before the operator signs off.
    await orchestrator.runIteration(goal.id);
    expect(harness.runner.provisioned).toHaveLength(0);
  });

  it("completes once every checkbox is satisfied, having dispatched specialists", async () => {
    const { projectId } = await harness.seedProject();
    const goal = await createGoal(projectId);
    const approved = await goals.approveDod(projectId, goal.id, {
      definitionOfDone: goal.definitionOfDone,
    });
    expect(approved.status).toBe("active");
    iterations = [];

    const [first, second] = approved.definitionOfDone;
    evaluator.queue = [
      { satisfiedIds: [], nextAgent: "senior-dev", brief: "build sign-in", complete: false, reasoning: "" },
      {
        satisfiedIds: [first!.id],
        nextAgent: "senior-dev",
        brief: "build the task list",
        complete: false,
        reasoning: "",
      },
      { satisfiedIds: [second!.id], nextAgent: null, brief: "", complete: true, reasoning: "done" },
    ];

    harness.runner.setScript([
      { kind: "tool", call: { name: "agentos_add_activity", input: { note: "signed in works" } } },
    ]);
    await orchestrator.runIteration(goal.id);

    harness.runner.setScript([
      { kind: "tool", call: { name: "agentos_add_activity", input: { note: "task list works" } } },
    ]);
    await orchestrator.runIteration(goal.id);
    await orchestrator.runIteration(goal.id);

    const finished = await goals.get(projectId, goal.id);
    expect(finished.status).toBe("completed");
    expect(finished.definitionOfDone.every((item) => item.done)).toBe(true);
    // Two specialist sessions ran, and each wrote to the shared progress log.
    expect(harness.runner.provisioned).toHaveLength(2);
    expect(finished.progressLog).toContain("signed in works");
    expect(finished.progressLog).toContain("task list works");
  });

  /** §22.9 — a zero cap refuses to spawn at all. */
  it("refuses to dispatch under a $0 spend cap", async () => {
    const { projectId } = await harness.seedProject();
    const goal = await createGoal(projectId, { spendCapUsd: 0 });
    await goals.approveDod(projectId, goal.id, { definitionOfDone: goal.definitionOfDone });

    evaluator.queue = [
      { satisfiedIds: [], nextAgent: "senior-dev", brief: "go", complete: false, reasoning: "" },
    ];
    await orchestrator.runIteration(goal.id);

    const stopped = await goals.get(projectId, goal.id);
    expect(stopped.status).toBe("stopped-spend");
    expect(harness.runner.provisioned).toHaveLength(0);
  });

  /** §22.9 — the time rail. */
  it("stops when the max duration has elapsed", async () => {
    const { projectId } = await harness.seedProject();
    const goal = await createGoal(projectId, { maxDurationMinutes: 30 });
    await goals.approveDod(projectId, goal.id, { definitionOfDone: goal.definitionOfDone });

    await harness.db
      .update(goalsTable)
      .set({ startedAt: new Date(Date.now() - 31 * 60_000) })
      .where(eq(goalsTable.id, goal.id));

    await orchestrator.runIteration(goal.id);
    const stopped = await goals.get(projectId, goal.id);
    expect(stopped.status).toBe("stopped-time");
    expect(stopped.stoppedReason).toMatch(/max duration/);
  });

  /** §22.9 — the stuck rail, with the threshold lowered so the test is honest. */
  it("stops after the configured number of no-progress iterations", async () => {
    const { projectId } = await harness.seedProject();
    const goal = await createGoal(projectId, { stuckThreshold: 2 });
    await goals.approveDod(projectId, goal.id, { definitionOfDone: goal.definitionOfDone });
    iterations = []; // approval queues the first turn; count only what the loop adds

    // The same specialist, writing nothing, twice.
    for (let index = 0; index < 3; index += 1) {
      evaluator.queue.push({
        satisfiedIds: [],
        nextAgent: "senior-dev",
        brief: "try again",
        complete: false,
        reasoning: "",
      });
      harness.runner.setScript([]);
      await orchestrator.runIteration(goal.id);
    }

    const stopped = await goals.get(projectId, goal.id);
    expect(stopped.status).toBe("stopped-stuck");
    expect(stopped.stoppedReason).toMatch(/no progress/);
    // The threshold counts no-progress iterations, full stop: two of them at a
    // threshold of 2 ends the goal.
    //
    // It used to also reset whenever the next specialist differed from the
    // last, which made the first turn free (there is no previous agent) and let
    // two alternating agents circle forever without the rail counting past one.
    // A different specialist is what a stuck goal *looks like*, so the reset is
    // gone and the rail fires a turn earlier than it once did.
    expect(harness.runner.provisioned).toHaveLength(2);
    // The first turn queued a successor; the one that tripped the rail did not,
    // so the loop ends rather than idling in the queue.
    expect(iterations).toHaveLength(1);
  });

  /** §22.14 — dispatch is limited to the project's own agents. */
  it("stops rather than dispatching an agent outside the allow list", async () => {
    const { projectId } = await harness.seedProject();
    const goal = await createGoal(projectId);
    await goals.approveDod(projectId, goal.id, { definitionOfDone: goal.definitionOfDone });

    evaluator.queue = [
      { satisfiedIds: [], nextAgent: null, brief: "", complete: false, reasoning: "chose an unknown agent" },
    ];
    await orchestrator.runIteration(goal.id);

    const stopped = await goals.get(projectId, goal.id);
    expect(stopped.status).toBe("stopped-stuck");
    expect(harness.runner.provisioned).toHaveLength(0);
    // The evaluator only ever sees this project's roster.
    expect(evaluator.seen[0]!.allowedAgents).toContain("senior-dev");
    expect(evaluator.seen[0]!.allowedAgents).not.toContain("customer-support-from-another-project");
  });

  it("requires an explicit acknowledgement to run without a spend cap", () => {
    const base = { title: "t", spec: "- do the thing" };
    expect(createGoalSchema.safeParse({ ...base, spendCapUsd: null }).success).toBe(false);
    expect(
      createGoalSchema.safeParse({ ...base, spendCapUsd: null, acknowledgeNoSpendCap: true }).success,
    ).toBe(true);
    expect(createGoalSchema.safeParse({ ...base, spendCapUsd: 25 }).success).toBe(true);
  });
});
