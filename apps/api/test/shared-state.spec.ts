import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { InboxService } from "../src/inbox/inbox.service";
import { SessionOrchestrator } from "../src/runner/session-orchestrator";
import { TasksService } from "../src/tasks/tasks.service";
import { createHarness, type Harness } from "./harness";

/**
 * A goal's shared state (SPEC §11): one folder and one inbox thread, held by
 * every specialist that works it and by no one else.
 */
describe("goal shared state", () => {
  let harness: Harness;
  let orchestrator: SessionOrchestrator;
  let tasks: TasksService;
  let inbox: InboxService;

  beforeAll(async () => {
    harness = await createHarness();
    orchestrator = harness.app.get(SessionOrchestrator);
    tasks = harness.app.get(TasksService);
    inbox = harness.app.get(InboxService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
  });

  it("gives a goal session read and write on its own folder, and delete on nothing", async () => {
    const { projectId } = await harness.seedProject();
    const goalId = randomUUID();
    const otherGoalId = randomUUID();

    harness.runner.setScript([
      {
        kind: "tool",
        call: {
          name: "fs_write",
          input: { path: `/goals/${goalId}/notes.md`, content: "what I found" },
        },
      },
      { kind: "tool", call: { name: "fs_read", input: { path: `/goals/${goalId}/notes.md` } } },
      { kind: "tool", call: { name: "fs_delete", input: { path: `/goals/${goalId}/notes.md` } } },
      {
        kind: "tool",
        call: { name: "fs_write", input: { path: `/goals/${otherGoalId}/steal.md`, content: "x" } },
      },
    ]);

    await orchestrator.runGoalStep({
      goalId,
      projectId,
      agentName: "senior-dev",
      brief: "look around",
      budgetUsd: null,
    });

    const [write, read, remove, otherGoal] = harness.runner.injectedResults.map(
      (entry) => entry.result,
    );
    expect(write).toMatch(/wrote/);
    expect(read).toBe("what I found");
    // Shared, but not erasable: the next specialist has to find what the last
    // one left.
    expect(remove).toMatch(/refused/);
    expect(otherGoal).toMatch(/refused/);
  });

  it("keeps a task session out of the goal folders entirely", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const goalId = randomUUID();
    const task = await tasks.create(projectId, {
      name: "Unrelated",
      description: "",
      assigneeType: "agent",
      assigneeAgentId: agentIds["senior-dev"]!,
      attachmentIds: [],
      approvalGate: false,
      scheduleKind: "now",
      runAt: null,
      cron: null,
      timezone: null,
    });

    harness.runner.setScript([
      { kind: "tool", call: { name: "fs_write", input: { path: `/goals/${goalId}/x.md`, content: "x" } } },
    ]);
    await orchestrator.runTask(task.id);

    expect(harness.runner.injectedResults.at(0)?.result).toMatch(/refused/);
  });
});

/** SPEC §20: the Inbox MCP is send, ask *and* read. */
describe("inbox_read", () => {
  let harness: Harness;
  let orchestrator: SessionOrchestrator;
  let tasks: TasksService;

  beforeAll(async () => {
    harness = await createHarness();
    orchestrator = harness.app.get(SessionOrchestrator);
    tasks = harness.app.get(TasksService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
  });

  it("returns this task's thread, and nothing from another card", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const make = (name: string) =>
      tasks.create(projectId, {
        name,
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

    const mine = await make("Mine");
    const other = await make("Someone else's");

    harness.runner.setScript([
      { kind: "tool", call: { name: "inbox_send", input: { body: "a note about the other card" } } },
    ]);
    await orchestrator.runTask(other.id);

    harness.runner.setScript([
      { kind: "tool", call: { name: "inbox_send", input: { body: "a note about my card" } } },
      { kind: "tool", call: { name: "inbox_read", input: {} } },
    ]);
    await orchestrator.runTask(mine.id);

    const thread = harness.runner.injectedResults.at(-1)?.result ?? "";
    expect(thread).toContain("a note about my card");
    expect(thread).not.toContain("a note about the other card");
  });

  it("refuses an agent that was not granted the inbox", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const agents = harness.app.get(
      (await import("../src/agents/agents.service")).AgentsService,
    );
    await agents.update(projectId, agentIds.default!, { inboxAccess: false });

    const task = await tasks.create(projectId, {
      name: "No inbox",
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

    harness.runner.setScript([{ kind: "tool", call: { name: "inbox_read", input: {} } }]);
    await orchestrator.runTask(task.id);

    expect(harness.runner.injectedResults.at(0)?.result).toMatch(/no inbox access/);
  });
});
