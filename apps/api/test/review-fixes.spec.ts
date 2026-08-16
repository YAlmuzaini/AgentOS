import { UnauthorizedException } from "@nestjs/common";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GoalsService } from "../src/goals/goals.service";
import { InboxService } from "../src/inbox/inbox.service";
import { SessionOrchestrator } from "../src/runner/session-orchestrator";
import { SessionsService } from "../src/sessions/sessions.service";
import { SessionQueue } from "../src/queue/session.queue";
import { TasksService } from "../src/tasks/tasks.service";
import { TemplatesService } from "../src/templates/templates.service";
import { TriggersService } from "../src/triggers/triggers.service";
import { sign } from "../src/triggers/webhook-signature";
import { createHarness, type Harness } from "./harness";

/**
 * Regressions for the findings of the first independent review.
 *
 * Each of these passed review as "obviously correct" code and was not. They are
 * grouped together deliberately: the shape of the mistake — a check separated
 * from the write it protects — repeats.
 */
describe("review findings", () => {
  let harness: Harness;
  let tasks: TasksService;
  let templates: TemplatesService;
  let triggers: TriggersService;
  let enqueued: string[];

  beforeAll(async () => {
    harness = await createHarness();
    tasks = harness.app.get(TasksService);
    templates = harness.app.get(TemplatesService);
    triggers = harness.app.get(TriggersService);

    // The stub keeps the real signature *and* the real key validation: an
    // earlier version of this test dropped the dedupe argument on the floor,
    // which is exactly how a job id BullMQ refuses reached production code.
    const queue = harness.app.get(SessionQueue);
    const real = queue.enqueueRun.bind(queue);
    queue.enqueueRun = async (taskId: string, dedupeKey?: string) => {
      if (dedupeKey?.includes(":")) {
        throw new Error(`dedupe key "${dedupeKey}" contains ':', which BullMQ rejects`);
      }
      void real;
      enqueued.push(taskId);
    };
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    enqueued = [];
  });

  /**
   * Two operators — or one impatient double click — closing the same card must
   * release the next step once. The old code read the status, then wrote
   * unconditionally, so both callers saw "not done yet" and both advanced.
   */
  it("releases a chain step once when two completions race", async () => {
    const { projectId } = await harness.seedProject();
    const [template] = await templates.installBuiltIns(projectId);
    const chain = await templates.instantiate(projectId, template!.id, {
      variables: { branchName: "feat/x", feature: "x" },
      titlePrefix: "",
    });
    enqueued = [];

    const first = chain[0]!;
    const results = await Promise.allSettled([
      tasks.patch(projectId, first.id, { status: "done" }),
      tasks.patch(projectId, first.id, { status: "done" }),
    ]);

    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toBe(chain[1]!.id);
  });

  /**
   * The gate is enforced in the update predicate, not only in a prior read, so
   * an operator turning it on mid-flight still wins.
   */
  it("refuses an agent close on a card that became gated", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const task = await tasks.create(projectId, {
      name: "Gate me",
      description: "",
      assigneeType: "agent",
      assigneeAgentId: agentIds.default!,
      attachmentIds: [],
      approvalGate: false,
      scheduleKind: "now",
      runAt: null,
      cron: null,
      timezone: null,
    });

    await tasks.patch(projectId, task.id, { approvalGate: true });
    await expect(tasks.setStatusFromAgent(task.id, "done")).rejects.toThrow(/approval-gated/);
    expect((await tasks.get(projectId, task.id)).status).not.toBe("done");
  });

  /** Rotation has to beat a delivery that read the old salt first. */
  it("rejects a delivery whose secret was rotated mid-flight", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const trigger = await triggers.create(projectId, {
      name: "rotate-race",
      agentId: agentIds.default!,
      jobPrompt: "handle it",
      enabled: true,
    });

    const timestamp = Date.now();
    const body = "{}";
    const signature = sign(trigger.signingKey, timestamp, body);

    // The rotation lands after the signature was minted but before delivery.
    await triggers.rotateSecret(projectId, trigger.id);

    await expect(
      triggers.handleDelivery({
        triggerId: trigger.id,
        rawBody: body,
        signature,
        timestamp: String(timestamp),
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  /**
   * A spent signature with no task is the worst outcome: the sender's retry is
   * rejected as a replay and the event is lost silently.
   */
  it("releases the replay claim when the job cannot be created", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const trigger = await triggers.create(projectId, {
      name: "dispatch-fails",
      agentId: agentIds.default!,
      jobPrompt: "handle it",
      enabled: true,
    });

    const timestamp = Date.now();
    const body = JSON.stringify({ hello: "world" });
    const signature = sign(trigger.signingKey, timestamp, body);

    const create = tasks.create.bind(tasks);
    tasks.create = async () => {
      throw new Error("the queue is down");
    };
    await expect(
      triggers.handleDelivery({
        triggerId: trigger.id,
        rawBody: body,
        signature,
        timestamp: String(timestamp),
      }),
    ).rejects.toThrow("the queue is down");
    tasks.create = create;

    // The same delivery now succeeds: the claim was released, not spent.
    const retried = await triggers.handleDelivery({
      triggerId: trigger.id,
      rawBody: body,
      signature,
      timestamp: String(timestamp),
    });
    expect(retried.taskId).toBeTruthy();
  });

  /**
   * A goal is a spend cap with a loop attached. Two loops against one cap each
   * read the same remaining budget and can each spend all of it.
   */
  it("lets only one iteration of a goal dispatch at a time", async () => {
    const { projectId } = await harness.seedProject();
    const goals = harness.app.get(GoalsService);
    const goal = await goals.create(projectId, {
      title: "Ship it",
      spec: "- ship the thing\n- write it down",
      definitionOfDone: [],
      spendCapUsd: 5,
      acknowledgeNoSpendCap: false,
      maxDurationMinutes: null,
      runnerPreference: "auto",
    });

    const [first, second] = await Promise.all([
      goals.claimIteration(goal.id),
      goals.claimIteration(goal.id),
    ]);
    const holders = [first, second].filter((token): token is string => token !== null);
    expect(holders).toHaveLength(1);

    // Releasing hands the slot to the next queued iteration rather than
    // holding it until the lease expires.
    await goals.releaseIteration(goal.id, holders[0]!);
    const next = await goals.claimIteration(goal.id);
    expect(next).not.toBeNull();

    // A worker whose lease already expired must not be able to clear the lease
    // of whoever took over from it: that would let a third dispatch start
    // against the same remaining budget.
    await goals.releaseIteration(goal.id, holders[0]!);
    expect(await goals.claimIteration(goal.id)).toBeNull();

    // And the holder can extend its own lease, which is what stops the lease
    // expiring under a specialist that is legitimately still running.
    expect(await goals.renewIteration(goal.id, next!)).toBe(true);
    expect(await goals.renewIteration(goal.id, "not-the-holder")).toBe(false);
  });

  /**
   * The claim moves a session out of `waiting-inbox`, where both the reaper and
   * the resume path can see it. A rejected answer must not leave it stranded
   * outside that state.
   */
  it("leaves a session parked when the answer is rejected", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const orchestrator = harness.app.get(SessionOrchestrator);
    const inbox = harness.app.get(InboxService);
    const sessions = harness.app.get(SessionsService);

    const task = await tasks.create(projectId, {
      name: "Ask something",
      description: "",
      assigneeType: "agent",
      assigneeAgentId: agentIds.spec!,
      attachmentIds: [],
      approvalGate: false,
      scheduleKind: "now",
      runAt: null,
      cron: null,
      timezone: null,
    });
    harness.runner.setScript([
      {
        kind: "tool",
        call: {
          name: "inbox_ask",
          input: {
            question: "Which backend?",
            choices: [
              { id: "postgres", label: "Postgres" },
              { id: "sqlite", label: "SQLite" },
            ],
          },
        },
      },
    ]);
    await orchestrator.runTask(task.id);

    const [message] = await inbox.list(undefined, "open");
    await expect(inbox.reply(message!.id, { selectedChoiceId: "mongodb" })).rejects.toThrow(
      /not one of the offered choices/,
    );

    const [session] = await sessions.list();
    expect(session!.status).toBe("waiting-inbox");
  });

});
