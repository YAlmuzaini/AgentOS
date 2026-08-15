import { goals as goalsTable, sessions as sessionsTable } from "@agentos/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GoalContinuity } from "../src/goals/goal-continuity";
import { GoalsService } from "../src/goals/goals.service";
import { InboxService } from "../src/inbox/inbox.service";
import { SessionQueue } from "../src/queue/session.queue";
import { MaintenanceService } from "../src/runner/maintenance.service";
import { VaultCleanup } from "../src/runner/vault-cleanup";
import { SessionOrchestrator } from "../src/runner/session-orchestrator";
import { SessionsService } from "../src/sessions/sessions.service";
import { SettingsService } from "../src/settings/settings.service";
import { createHarness, type Harness } from "./harness";
import { stubQueue, type QueueSink } from "./queue-stub";

/**
 * What happens to a goal when the thing that would have continued it does not.
 *
 * The gauntlet loop is a chain of queue jobs, and every link is a place the
 * chain can end without anyone being told. Each test here breaks one link.
 */
describe("continuity — round five", () => {
  let harness: Harness;
  let goals: GoalsService;
  let continuity: GoalContinuity;
  let maintenance: MaintenanceService;
  let vaults: VaultCleanup;
  let sessions: SessionsService;
  let inbox: InboxService;
  let settings: SettingsService;
  let orchestrator: SessionOrchestrator;
  let queued: QueueSink;

  beforeAll(async () => {
    harness = await createHarness();
    goals = harness.app.get(GoalsService);
    continuity = harness.app.get(GoalContinuity);
    maintenance = harness.app.get(MaintenanceService);
    vaults = harness.app.get(VaultCleanup);
    sessions = harness.app.get(SessionsService);
    inbox = harness.app.get(InboxService);
    settings = harness.app.get(SettingsService);
    orchestrator = harness.app.get(SessionOrchestrator);
    queued = stubQueue(harness);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    queued.clear();
  });

  async function activeGoal(projectId: string) {
    const goal = await goals.create(projectId, {
      title: "Ship onboarding",
      spec: "- the operator can sign in",
      definitionOfDone: [],
      spendCapUsd: 10,
      acknowledgeNoSpendCap: false,
      maxDurationMinutes: null,
      stuckThreshold: 19,
      runnerPreference: "auto",
    } as never);
    await goals.approveDod(projectId, goal.id, { definitionOfDone: goal.definitionOfDone });
    queued.clear();
    return goal.id;
  }

  /** Parks a goal session on a question and backdates the park. */
  async function parkedGoalSession(minutesAgo: number) {
    const { projectId, agentIds } = await harness.seedProject();
    const goalId = await activeGoal(projectId);

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
    await orchestrator.runGoalStep({
      goalId,
      projectId,
      agentName: "senior-dev",
      brief: "do the thing",
      budgetUsd: 10,
    });

    const [session] = await sessions.list();
    expect(session!.status).toBe("waiting-inbox");
    await harness.db
      .update(sessionsTable)
      .set({ parkedAt: new Date(Date.now() - minutesAgo * 60_000) })
      .where(eq(sessionsTable.id, session!.id));

    return { projectId, goalId, sessionId: session!.id, agentIds };
  }

  /**
   * The reaper frees the container, but nothing was queueing the goal's next
   * turn — the resume that would have done it is never going to happen. The
   * goal sat `active` forever, with no session, no job, and nothing said.
   */
  it("stops a goal whose specialist was reaped, and books what it spent", async () => {
    const { projectId, goalId } = await parkedGoalSession(25 * 60);
    await settings.update(projectId, {
      parkedSessionTimeoutMinutes: 1440,
      orphanSweepEnabled: false,
      orphanSweepIntervalMinutes: 15,
    });

    expect(await maintenance.reapParkedSessions()).toBe(1);

    const after = await goals.get(projectId, goalId);
    expect(after.status).toBe("stopped-stuck");
    expect(after.stoppedReason).toContain("went unanswered");
    // Everything the specialist spent before it asked its question.
    expect(after.spendUsd).toBeCloseTo(0.25, 4);
  });

  /**
   * A Redis blip where the successor is enqueued used to end the goal
   * permanently: the row still says `active`, and nothing is queued.
   */
  it("re-queues an active goal that has nothing left to run it", async () => {
    const { projectId } = await harness.seedProject();
    const goalId = await activeGoal(projectId);
    // Older than the stall grace period, with no session and no lease.
    await harness.db
      .update(goalsTable)
      .set({ updatedAt: new Date(Date.now() - 60 * 60_000) })
      .where(eq(goalsTable.id, goalId));

    expect(await continuity.recoverStalledGoals()).toBe(1);
    expect(queued.goalIterations).toEqual([goalId]);
    // Keyed by the stalled state, not the goal alone. A key of just the goal id
    // is a permanent wedge: BullMQ dedupes against the *completed* first job,
    // which it retains, so every later recovery creates no work at all.
    const stalled = await harness.db
      .select()
      .from(goalsTable)
      .where(eq(goalsTable.id, goalId));
    expect(queued.goalIterationKeys[0]).toContain(goalId);
    expect(queued.goalIterationKeys[0]).not.toBe(`goal-recovery-${goalId}`);
    expect(queued.goalIterationKeys[0]).toMatch(/-\d{10,}$/);
    expect(stalled).toHaveLength(1);

    const after = await goals.get(projectId, goalId);
    expect(after.progressLog).toContain("restarting the loop");
  });

  /** A goal that is merely busy must not be re-queued underneath itself. */
  it("leaves a goal alone while one of its sessions is still parked", async () => {
    const { goalId } = await parkedGoalSession(5);
    await harness.db
      .update(goalsTable)
      .set({ updatedAt: new Date(Date.now() - 60 * 60_000) })
      .where(eq(goalsTable.id, goalId));

    expect(await continuity.recoverStalledGoals()).toBe(0);
    expect(queued.goalIterations).toEqual([]);
  });

  /**
   * The answer committed before the resume job was queued. When the queue
   * refused it, the message stayed `answered` — so every later attempt was
   * rejected as already answered, and the container had no way back.
   */
  it("reopens an answered question when its resume could not be queued", async () => {
    const { sessionId } = await parkedGoalSession(1);
    const message = (await inbox.list("open"))[0]!;

    const queue = harness.app.get(SessionQueue);
    queue.enqueueResume = async () => {
      throw new Error("the queue is down");
    };

    await expect(inbox.reply(message.id, { selectedChoiceId: "pg", body: null })).rejects.toThrow(
      /queue is down/,
    );

    // Both halves came back: the question can be answered again, and the
    // session is where the reaper and the resume path can both see it.
    const reopened = await inbox.require(message.id);
    expect(reopened.status).toBe("open");
    expect(reopened.selectedChoiceId).toBeNull();
    expect((await sessions.get(sessionId)).status).toBe("waiting-inbox");

    // And the retry works once the queue is back.
    queued.clear();
    stubQueue(harness);
    await inbox.reply(message.id, { selectedChoiceId: "pg", body: null });
    expect((await inbox.require(message.id)).status).toBe("answered");
  });

  /**
   * The pending-vault list took the newest 200 sessions and filtered them, so
   * a stranded credential became invisible as soon as 200 newer sessions
   * existed — permanently, and with no error anywhere.
   */
  it("finds a stranded vault behind hundreds of newer sessions", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const stranded = await sessions.create({
      projectId,
      agentId: agentIds.spec!,
      runner: "cloud",
    });
    await sessions.recordVaults(stranded.id, ["vlt_stranded"]);
    await sessions.finish(stranded.id, { status: "failed", error: "destroy failed" });
    await harness.db
      .update(sessionsTable)
      .set({ startedAt: new Date(Date.now() - 48 * 60 * 60_000) })
      .where(eq(sessionsTable.id, stranded.id));

    for (let index = 0; index < 205; index += 1) {
      const filler = await sessions.create({
        projectId,
        agentId: agentIds.spec!,
        runner: "cloud",
      });
      await sessions.finish(filler.id, { status: "destroyed", error: null });
    }

    const pending = await sessions.sessionsWithPendingVaults();
    expect(pending.map((row) => row.id)).toContain(stranded.id);

    // And maintenance actually drains it.
    expect(await vaults.drain()).toBe(1);
    expect(harness.runner.vaultsDeleted).toContain("vlt_stranded");
    // The row is the retry queue, so it has to come off it once the
    // credentials are provably gone.
    const [cleared] = await harness.db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.id, stranded.id));
    expect(cleared!.runtimeVaultIds).toEqual([]);
  });
});
