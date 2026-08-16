import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SessionOrchestrator } from "../src/runner/session-orchestrator";
import { TasksService } from "../src/tasks/tasks.service";
import { createHarness, type Harness } from "./harness";

/**
 * SPEC §22.1 (session destroy) and §22.5 (approval gate), plus the Phase 1
 * done-when: a task runs, the agent moves it through the AgentOS tool, and the
 * container is destroyed.
 */
describe("session lifecycle", () => {
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

  it("runs a task to done and destroys the container", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const task = await tasks.create(projectId, {
      name: "Say hello",
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

    harness.runner.setScript([
      { kind: "tool", call: { name: "agentos_update_task", input: { status: "doing" } } },
      { kind: "log", type: "agent.message", summary: "hello" },
      {
        kind: "tool",
        call: { name: "agentos_update_task", input: { status: "done", note: "greeted" } },
      },
    ]);

    await orchestrator.runTask(task.id);

    const after = await tasks.get(projectId, task.id);
    expect(after.status).toBe("done");

    const sessions = await harness.app.get(TasksService) && (await listSessions(harness));
    expect(sessions[0]!.status).toBe("destroyed");
    expect(harness.runner.destroyed).toHaveLength(1);
    // The whole run is replayable from the persisted log.
    expect(sessions[0]!.toolCallLog.length).toBeGreaterThanOrEqual(3);

    const activity = await tasks.listActivity(task.id);
    expect(activity.map((entry) => entry.body)).toContain("greeted");
  });

  /**
   * SPEC §6 says the container is destroyed on every exit path. It was not:
   * a failure after provisioning recorded the session as failed and left the
   * container running, billing, with nothing pointing at it.
   */
  it("destroys the container when the run fails after provisioning", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const task = await tasks.create(projectId, {
      name: "Fails mid-run",
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

    harness.runner.failNextStream(new Error("the event stream dropped"));
    await orchestrator.runTask(task.id);

    const sessions = await listSessions(harness);
    expect(sessions[0]!.status).toBe("failed");
    expect(sessions[0]!.error).toContain("the event stream dropped");
    expect(harness.runner.destroyed).toEqual([sessions[0]!.runtimeHandle]);
  });

  it("refuses done on an approval-gated task and leaves it in review", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const task = await tasks.create(projectId, {
      name: "Write a spec",
      description: "",
      assigneeType: "agent",
      assigneeAgentId: agentIds.spec!,
      attachmentIds: [],
      approvalGate: true,
      scheduleKind: "now",
      runAt: null,
      cron: null,
      timezone: null,
    });

    harness.runner.setScript([
      { kind: "tool", call: { name: "agentos_update_task", input: { status: "review" } } },
      { kind: "tool", call: { name: "agentos_update_task", input: { status: "done" } } },
    ]);

    await orchestrator.runTask(task.id);

    const after = await tasks.get(projectId, task.id);
    expect(after.status).toBe("review");

    // The refusal is handed back to the agent rather than crashing the run.
    const refusal = harness.runner.injectedResults.at(-1);
    expect(refusal?.result).toMatch(/approval-gated/);

    // The operator can still close it.
    const closed = await tasks.patch(projectId, task.id, { status: "done" }, "human");
    expect(closed.status).toBe("done");
  });

  it("records the failure and still ends the session when provisioning fails", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const task = await tasks.create(projectId, {
      name: "Broken",
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

    harness.runner.failNextProvision(new Error("no credential"));
    await orchestrator.runTask(task.id);

    const sessions = await listSessions(harness);
    expect(sessions[0]!.status).toBe("failed");
    expect(sessions[0]!.error).toMatch(/no credential/);
  });

  /**
   * SPEC §13: the session screen has to be able to say what the run could
   * touch, not only what it did. Recorded at provision from the resolved
   * grants, and holding names rather than values — it ends up on a screen.
   */
  it("records what the session was granted, without any secret values", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const task = await tasks.create(projectId, {
      name: "Look around",
      description: "",
      assigneeType: "agent",
      assigneeAgentId: agentIds.plan!,
      attachmentIds: [],
      approvalGate: false,
      scheduleKind: "now",
      runAt: null,
      cron: null,
      timezone: null,
    });

    harness.runner.setScript([
      { kind: "tool", call: { name: "agentos_update_task", input: { status: "done" } } },
    ]);
    await orchestrator.runTask(task.id);

    const [session] = await listSessions(harness);
    const access = session!.access;
    expect(access).not.toBeNull();
    expect(access!.model).toBe("claude-opus-5");
    expect(access!.tools).toContain("agentos_update_task");
    expect(access!.tools).toContain("fs_write");
    // A seeded agent has no environment, which resolves to deny-everything.
    expect(access!.networking).toBe("limited");
    expect(access!.allowedHosts).toEqual([]);
    expect(access!.folders.join(" ")).toContain("/agents/plan/");
    // The plan agent holds no repo, no MCP server and no env binding.
    expect(access!.repos).toEqual([]);
    expect(access!.mcpServers).toEqual([]);
    expect(access!.envVarKeys).toEqual([]);
    // And the session says who ran it, so the screen needs no second fetch.
    expect(session!.agentName).toBe("plan");
  });
});

async function listSessions(harness: Harness) {
  const { SessionsService } = await import("../src/sessions/sessions.service");
  return harness.app.get(SessionsService).list();
}
