import { agents as agentsTable, environments, goalDecisions, goals as goalsTable, handoffs, sessions } from "@agentos/db";
import { createGoalSchema } from "@agentos/shared";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GOAL_EVALUATOR, type GoalEvaluation, type GoalEvaluator } from "../src/goals/goal-evaluator";
import { GoalOrchestrator } from "../src/goals/goal-orchestrator";
import { GoalsService } from "../src/goals/goals.service";
import { MAX_UNAVAILABLE_TURNS } from "../src/goals/goal-rails";
import { LocalDecisionUnavailableError } from "../src/runner/local-runner";
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
  seen: Array<{ eligibleAgents: Array<{ name: string }> }> = [];

  async evaluate(input: { eligibleAgents: Array<{ name: string }> }): Promise<GoalEvaluation> {
    this.seen.push({ eligibleAgents: input.eligibleAgents });
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
    expect(evaluator.seen[0]!.eligibleAgents.map((agent) => agent.name)).toContain("senior-dev");
    expect(evaluator.seen[0]!.eligibleAgents.map((agent) => agent.name)).not.toContain("customer-support-from-another-project");
  });

  it("owns bounded parallel specialists under one goal and accounts every child", async () => {
    const { projectId } = await harness.seedProject();
    const goal = await createGoal(projectId, { spendCapUsd: 3 });
    await goals.approveDod(projectId, goal.id, { definitionOfDone: goal.definitionOfDone });
    iterations = [];
    evaluator.queue = [{
      satisfiedIds: [],
      nextAgent: "senior-dev",
      brief: "implement",
      complete: false,
      reasoning: "three independent checks",
      parallelAgents: [
        { agent: "code-review-coordinator", brief: "review correctness" },
        { agent: "security-reviewer", brief: "review security" },
      ],
    }];

    await orchestrator.runIteration(goal.id);

    const refreshed = await goals.get(projectId, goal.id);
    const childSessions = await harness.db.select().from(sessions).where(eq(sessions.goalId, goal.id));
    const childHandoffs = await harness.db.select().from(handoffs).where(eq(handoffs.goalId, goal.id));
    expect(childSessions).toHaveLength(3);
    expect(childSessions.every((session) => session.projectId === projectId)).toBe(true);
    expect(childHandoffs).toHaveLength(3);
    expect(refreshed.iterations).toBe(3);
    expect(refreshed.spendUsd).toBe(0.75);
    expect(iterations).toEqual([goal.id]);
  });

  /**
   * Progress accounting is per *turn*, not per child, and the documented
   * consequence is that a fan-out costs the stuck rail one mark, not one per
   * specialist. Before this, three fruitless children incremented the counter
   * three times, so a four-way fan-out tripped the rail four times faster than
   * a single dispatch of the same futility.
   */
  it("counts one no-progress mark for a whole fan-out turn", async () => {
    const { projectId } = await harness.seedProject();
    const goal = await createGoal(projectId, { stuckThreshold: 2 });
    await goals.approveDod(projectId, goal.id, { definitionOfDone: goal.definitionOfDone });
    iterations = [];

    evaluator.queue = [{
      satisfiedIds: [],
      nextAgent: "senior-dev",
      brief: "implement",
      complete: false,
      reasoning: "",
      parallelAgents: [
        { agent: "code-review-coordinator", brief: "review" },
        { agent: "security-reviewer", brief: "security" },
      ],
    }];
    harness.runner.setScript([]);
    await orchestrator.runIteration(goal.id);

    const afterFanOut = await harness.db.query.goals.findFirst({ where: eq(goalsTable.id, goal.id) });
    expect(afterFanOut!.stuckCount).toBe(1);
    expect((await goals.get(projectId, goal.id)).status).toBe("active");

    // A second fruitless turn reaches the threshold — and stops exactly once.
    evaluator.queue = [{ satisfiedIds: [], nextAgent: "senior-dev", brief: "again", complete: false, reasoning: "" }];
    harness.runner.setScript([]);
    await orchestrator.runIteration(goal.id);

    const stopped = await goals.get(projectId, goal.id);
    expect(stopped.status).toBe("stopped-stuck");
    expect(stopped.stoppedReason).toMatch(/no progress/);
    // Stopping is idempotent: a second attempt does not rewrite the reason.
    const reason = stopped.stoppedReason;
    await orchestrator.runIteration(goal.id);
    expect((await goals.get(projectId, goal.id)).stoppedReason).toBe(reason);
  });

  /**
   * The end-to-end form of the handoff-cap defect: a specialist that does real
   * work produces a long session summary, and recording it must not be able to
   * fail the turn. Before the fix the throw escaped `dispatch`, skipped
   * `recordProgress`, left the goal `active` with nothing queued, and the
   * recovery sweep re-ran the same doomed turn — spending on every attempt
   * while the stuck rail stood still.
   */
  it("survives a specialist whose summary is far larger than a handoff may hold", async () => {
    const { projectId } = await harness.seedProject();
    const goal = await createGoal(projectId, { stuckThreshold: 2 });
    await goals.approveDod(projectId, goal.id, { definitionOfDone: goal.definitionOfDone });
    iterations = [];

    // 200 tool calls: the summary is one line each, well past the outcome cap.
    harness.runner.setScript(
      Array.from({ length: 200 }, (_, index) => ({
        kind: "tool" as const,
        call: { name: "fs_write", input: { path: `/agents/senior-dev/file-${index}.md`, content: "x".repeat(80) } },
      })),
    );
    evaluator.queue = [{ satisfiedIds: [], nextAgent: "senior-dev", brief: "implement", complete: false, reasoning: "" }];

    await expect(orchestrator.runIteration(goal.id)).resolves.toBeUndefined();

    const after = await harness.db.query.goals.findFirst({ where: eq(goalsTable.id, goal.id) });
    // The turn completed: progress was recorded and the loop queued its successor.
    expect(after!.stuckCount).toBe(1);
    expect(iterations).toEqual([goal.id]);
    // And the handoff exists, truncated rather than missing.
    const recorded = await harness.db.select().from(handoffs).where(eq(handoffs.goalId, goal.id));
    expect(recorded).toHaveLength(1);
    // Truncated, which is the proof this test is not passing vacuously: the
    // raw summary really did exceed the cap that used to throw.
    expect(recorded[0]!.payload.outcome.length).toBe(4_000);
    expect(recorded[0]!.payload.outcome.endsWith("…")).toBe(true);
  });

  /**
   * The worst shape the loop had: a *persistent* evaluator failure — the model
   * naming an ineligible agent fails identically every time — used to throw out
   * of the iteration before `reserveIteration` and before `recordProgress`. So
   * the iteration ceiling never moved, the stuck counter never moved, the queue
   * job died, and the continuity sweep re-queued the goal every fifteen minutes
   * for ever, making a fresh metered evaluator call on each pass that no rail
   * could see.
   *
   * A failed decision is now a turn without progress, so the goal converges on
   * the operator's own stuck threshold and stops itself.
   */
  it("counts a failing evaluator as a turn without progress and stops at the stuck rail", async () => {
    const { projectId } = await harness.seedProject();
    const goal = await createGoal(projectId, { stuckThreshold: 2 });
    await goals.approveDod(projectId, goal.id, { definitionOfDone: goal.definitionOfDone });
    iterations = [];

    const failing: GoalEvaluator = {
      evaluate: async () => {
        throw new Error('goal evaluator selected ineligible agent "ghost"');
      },
    };
    const original = (orchestrator as unknown as { evaluator: GoalEvaluator }).evaluator;
    (orchestrator as unknown as { evaluator: GoalEvaluator }).evaluator = failing;
    try {
      // First failure: counted, goal still active, nothing re-queued by the loop.
      await expect(orchestrator.runIteration(goal.id)).resolves.toBeUndefined();
      const once = await harness.db.query.goals.findFirst({ where: eq(goalsTable.id, goal.id) });
      expect(once!.stuckCount).toBe(1);
      expect(once!.status).toBe("active");
      // No container was ever created, and no iteration was consumed.
      expect(harness.runner.provisioned).toHaveLength(0);
      expect(once!.iterations).toBe(0);
      expect(iterations).toEqual([]);

      // Second failure reaches the threshold and ends the goal for good.
      await expect(orchestrator.runIteration(goal.id)).resolves.toBeUndefined();
    } finally {
      (orchestrator as unknown as { evaluator: GoalEvaluator }).evaluator = original;
    }

    const stopped = await goals.get(projectId, goal.id);
    expect(stopped.status).toBe("stopped-stuck");
    expect(stopped.stoppedReason).toMatch(/no progress/);
    expect(stopped.progressLog).toContain("could not decide this turn");
  });

  /**
   * A worker that was *busy* is not a decision that *failed*. It cost nothing,
   * so counting it against the stuck rail would stop the goal with "no
   * progress across 19 iterations" when the truth was "the local worker was
   * saturated" — the wrong reason, and a goal killed by its own availability.
   */
  it("does not charge a busy local worker to the stuck rail", async () => {
    const { projectId } = await harness.seedProject();
    // Approved as `auto` — a `local` goal correctly fails preflight here,
    // because the test harness has no worker — then pinned to `local`, which is
    // the configuration this failure actually happens in.
    const goal = await createGoal(projectId, { stuckThreshold: 2 });
    await goals.approveDod(projectId, goal.id, { definitionOfDone: goal.definitionOfDone });
    await harness.db.update(goalsTable).set({ runnerPreference: "local" }).where(eq(goalsTable.id, goal.id));
    // Local compatibility needs an `open` environment, or the roster is empty
    // and the goal stops for that reason before the evaluator is ever called.
    const open = await harness.db.query.environments.findFirst({
      where: and(eq(environments.projectId, projectId), eq(environments.name, "open")),
    });
    await harness.db.update(agentsTable).set({ environmentId: open!.id }).where(eq(agentsTable.projectId, projectId));
    iterations = [];

    const busy: GoalEvaluator = {
      evaluate: async () => {
        throw new LocalDecisionUnavailableError("the local worker is at capacity; retry later");
      },
    };
    const original = (orchestrator as unknown as { evaluator: GoalEvaluator }).evaluator;
    (orchestrator as unknown as { evaluator: GoalEvaluator }).evaluator = busy;
    try {
      for (let i = 0; i < 4; i += 1) {
        await expect(orchestrator.runIteration(goal.id)).resolves.toBeUndefined();
      }
    } finally {
      (orchestrator as unknown as { evaluator: GoalEvaluator }).evaluator = original;
    }

    const after = await harness.db.query.goals.findFirst({ where: eq(goalsTable.id, goal.id) });
    // Four busy turns, and the goal is untouched: still active, nothing spent,
    // no container, and the stuck counter exactly where it started.
    expect(after!.status).toBe("active");
    expect(after!.stuckCount).toBe(0);
    expect(after!.iterations).toBe(0);
    expect(harness.runner.provisioned).toHaveLength(0);
    expect(after!.progressLog).toContain("could not take this turn's decision");
    expect(after!.progressLog).not.toContain("counting it as a turn without progress");
  });

  /**
   * …but waiting is not free of a bound either. An operator who drains a worker
   * and forgets would otherwise leave every local goal spinning every fifteen
   * minutes for ever, silently and with no stop and no push. Waiting gets a
   * rail of its own rather than borrowing the stuck counter, which is what
   * produced the wrong-reason stop this whole path exists to avoid.
   */
  it("stops a goal that has waited on an unavailable worker for too many turns", async () => {
    const { projectId } = await harness.seedProject();
    const goal = await createGoal(projectId, { stuckThreshold: 19 });
    await goals.approveDod(projectId, goal.id, { definitionOfDone: goal.definitionOfDone });
    await harness.db.update(goalsTable).set({ runnerPreference: "local" }).where(eq(goalsTable.id, goal.id));
    const open = await harness.db.query.environments.findFirst({
      where: and(eq(environments.projectId, projectId), eq(environments.name, "open")),
    });
    await harness.db.update(agentsTable).set({ environmentId: open!.id }).where(eq(agentsTable.projectId, projectId));

    // The streak is counted from the durable decision audit, which the real
    // evaluator writes. The scripted one does not, so the history is seeded.
    await harness.db.insert(goalDecisions).values(
      Array.from({ length: MAX_UNAVAILABLE_TURNS }, () => ({
        projectId,
        goalId: goal.id,
        backend: "local",
        provider: "claude-code-subscription",
        model: "claude-opus-5",
        inputHash: "x".repeat(64),
        durationMs: 5,
        status: "unavailable",
      })),
    );

    const busy: GoalEvaluator = {
      evaluate: async () => {
        throw new LocalDecisionUnavailableError("still draining");
      },
    };
    const original = (orchestrator as unknown as { evaluator: GoalEvaluator }).evaluator;
    (orchestrator as unknown as { evaluator: GoalEvaluator }).evaluator = busy;
    try {
      await orchestrator.runIteration(goal.id);
    } finally {
      (orchestrator as unknown as { evaluator: GoalEvaluator }).evaluator = original;
    }

    const stopped = await goals.get(projectId, goal.id);
    expect(stopped.status).toBe("stopped-stuck");
    expect(stopped.stoppedReason).toMatch(/could not take an orchestration decision/);
    // The pinned-to-local clause is conditional, and this goal is pinned.
    expect(stopped.stoppedReason).toMatch(/not sent to the cloud because it is pinned to local/);
    // And it does not promise a restart the product does not have.
    expect(stopped.stoppedReason).toMatch(/cannot be restarted/);
    // A single successful decision in the history resets the wait.
    expect(await goals.consecutiveUnavailableDecisions(goal.id)).toBe(MAX_UNAVAILABLE_TURNS);
    await harness.db.insert(goalDecisions).values({
      projectId, goalId: goal.id, backend: "local", provider: "claude-code-subscription",
      model: "claude-opus-5", inputHash: "y".repeat(64), durationMs: 5, status: "success",
    });
    expect(await goals.consecutiveUnavailableDecisions(goal.id)).toBe(0);
  });

  /**
   * A fan-out must not lose its bookkeeping to one bad child. `Promise.all`
   * rejected on the first failure, so siblings that had genuinely finished were
   * never accounted for — while they went on writing spend and handoffs into a
   * turn nobody would settle.
   */
  it("settles the turn even when one child of a fan-out throws", async () => {
    const { projectId } = await harness.seedProject();
    const goal = await createGoal(projectId, { stuckThreshold: 5 });
    await goals.approveDod(projectId, goal.id, { definitionOfDone: goal.definitionOfDone });
    iterations = [];

    evaluator.queue = [{
      satisfiedIds: [],
      nextAgent: "senior-dev",
      brief: "implement",
      complete: false,
      reasoning: "",
      // `ghost` passes the evaluator's own allow-list check only because this
      // scripted evaluator bypasses it; dispatching it then throws.
      parallelAgents: [{ agent: "ghost-agent-that-does-not-exist", brief: "review" }],
    }];
    harness.runner.setScript([]);

    await expect(orchestrator.runIteration(goal.id)).resolves.toBeUndefined();

    const after = await harness.db.query.goals.findFirst({ where: eq(goalsTable.id, goal.id) });
    // The turn was settled despite the rejection: the counter moved.
    expect(after!.stuckCount).toBe(1);
    expect(after!.status).toBe("active");
    expect(after!.progressLog).toContain("could not be dispatched");
    // The healthy sibling still ran and still recorded its handoff.
    expect(harness.runner.provisioned).toHaveLength(1);
    expect(await harness.db.select().from(handoffs).where(eq(handoffs.goalId, goal.id))).toHaveLength(1);
    // A turn with a failed child does not queue a successor on its own.
    expect(iterations).toEqual([]);
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
