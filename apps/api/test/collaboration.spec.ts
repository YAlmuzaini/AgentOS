import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MAX_SPAWNS_PER_SESSION } from "../src/runner/collaboration";
import { SessionOrchestrator } from "../src/runner/session-orchestrator";
import { toolsForAgent } from "../src/runner/tools";
import { TasksService } from "../src/tasks/tasks.service";
import { AgentsService } from "../src/agents/agents.service";
import { createHarness, type Harness } from "./harness";

/**
 * SPEC §5.10 and §22.14: the collaboration list is the only spawn path, and it
 * is a wall rather than a prompt. The review coordinator of §10 step 3 is the
 * reason it exists — four reviewers, in parallel, each in its own container.
 */
describe("collaboration", () => {
  let harness: Harness;
  let orchestrator: SessionOrchestrator;
  let tasks: TasksService;
  let agents: AgentsService;

  beforeAll(async () => {
    harness = await createHarness();
    orchestrator = harness.app.get(SessionOrchestrator);
    tasks = harness.app.get(TasksService);
    agents = harness.app.get(AgentsService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
  });

  async function coordinatorTask(projectId: string, agentId: string, name = "Plan review") {
    return tasks.create(projectId, {
      name,
      description: "",
      assigneeType: "agent",
      assigneeAgentId: agentId,
      attachmentIds: [],
      approvalGate: false,
      scheduleKind: "now",
      runAt: null,
      cron: null,
      timezone: null,
    });
  }

  /** Grants the coordinator the four reviewers, the way the seed does. */
  async function allowReviewers(projectId: string, agentId: string, list: string[]) {
    await agents.update(projectId, agentId, { collaborationList: list });
  }

  it("attaches no spawn tool to an agent with an empty collaboration list", () => {
    const withList = toolsForAgent({ inboxAccess: true, collaborationList: ["feasibility"] });
    const without = toolsForAgent({ inboxAccess: true, collaborationList: [] });
    expect(withList.map((tool) => tool.name)).toContain("agentos_spawn_collaborators");
    expect(without.map((tool) => tool.name)).not.toContain("agentos_spawn_collaborators");
  });

  it("spawns the listed reviewers in parallel and reports what they recorded", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    await allowReviewers(projectId, agentIds["review-coordinator"]!, [
      "feasibility",
      "scope-guardian",
      "coherence",
      "plan-risk",
    ]);
    const card = await coordinatorTask(projectId, agentIds["review-coordinator"]!);

    harness.runner.setScript([
      {
        kind: "tool",
        call: {
          name: "agentos_spawn_collaborators",
          input: {
            waitMinutes: 1,
            collaborators: [
              { agent: "feasibility", name: "Feasibility review", brief: "Can it be built?" },
              { agent: "plan-risk", name: "Risk review", brief: "What is untested?" },
            ],
          },
        },
      },
      { kind: "tool", call: { name: "agentos_update_task", input: { status: "done" } } },
    ]);

    const run = orchestrator.runTask(card.id);

    // Stand in for the collaborators' own sessions: the queue has the jobs but
    // no worker is running in tests, so the cards are closed here instead.
    const spawned = await waitForSpawned(tasks, projectId, card.id, 2);
    for (const subtask of spawned) {
      await tasks.addActivity({ taskId: subtask.id, body: `${subtask.name} says: looks fine` });
      await tasks.patch(projectId, subtask.id, { status: "done" }, "human");
    }
    await run;

    expect(spawned.map((task) => task.parentTaskId)).toEqual([card.id, card.id]);
    expect(spawned.every((task) => task.spawnDepth === 1)).toBe(true);

    // The report is what the tool handed back to the coordinator.
    const report = harness.runner.injectedResults.at(0)?.result ?? "";
    expect(report).toContain("Feasibility review");
    expect(report).toContain("Risk review");
    expect(report).toContain("looks fine");
    expect(report).toContain('status "done"');
  }, 30_000);

  /**
   * The refusal has to happen before any container exists. Validating inside
   * the creation loop left the collaborators named before the bad one already
   * running and spending, with nothing reporting them back.
   */
  it("creates nothing when one collaborator in the list is refused", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    await allowReviewers(projectId, agentIds["review-coordinator"]!, ["feasibility"]);
    const card = await coordinatorTask(projectId, agentIds["review-coordinator"]!);

    harness.runner.setScript([
      {
        kind: "tool",
        call: {
          name: "agentos_spawn_collaborators",
          input: {
            waitMinutes: 1,
            collaborators: [
              { agent: "feasibility", name: "Allowed", brief: "review" },
              { agent: "senior-dev", name: "Not allowed", brief: "implement" },
            ],
          },
        },
      },
    ]);

    await orchestrator.runTask(card.id);

    expect(harness.runner.injectedResults.at(0)?.result).toMatch(/not on your collaboration list/);
    expect(await tasks.list(projectId)).toHaveLength(1);
  });

  it("refuses an agent that is not on the collaboration list", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    await allowReviewers(projectId, agentIds["review-coordinator"]!, ["feasibility"]);
    const card = await coordinatorTask(projectId, agentIds["review-coordinator"]!);

    harness.runner.setScript([
      {
        kind: "tool",
        call: {
          name: "agentos_spawn_collaborators",
          input: {
            collaborators: [{ agent: "senior-dev", name: "Just do it", brief: "implement" }],
          },
        },
      },
    ]);

    await orchestrator.runTask(card.id);

    expect(harness.runner.injectedResults.at(0)?.result).toMatch(/not on your collaboration list/);
    // Nothing was created: the refusal happens before any card exists.
    const all = await tasks.list(projectId);
    expect(all).toHaveLength(1);
  });

  it("refuses to spawn at all when the agent has no collaboration list", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const card = await coordinatorTask(projectId, agentIds.default!, "Do it yourself");

    harness.runner.setScript([
      {
        kind: "tool",
        call: {
          name: "agentos_spawn_collaborators",
          input: { collaborators: [{ agent: "feasibility", name: "Review", brief: "look" }] },
        },
      },
    ]);

    await orchestrator.runTask(card.id);

    expect(harness.runner.injectedResults.at(0)?.result).toMatch(/no collaboration list/);
    expect(await tasks.list(projectId)).toHaveLength(1);
  });

  it("caps how many collaborators one session may spawn", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    await allowReviewers(projectId, agentIds["review-coordinator"]!, ["feasibility"]);
    const card = await coordinatorTask(projectId, agentIds["review-coordinator"]!);

    harness.runner.setScript([
      {
        kind: "tool",
        call: {
          name: "agentos_spawn_collaborators",
          input: {
            waitMinutes: 1,
            collaborators: Array.from({ length: MAX_SPAWNS_PER_SESSION + 1 }, (_, index) => ({
              agent: "feasibility",
              name: `Review ${index}`,
              brief: "look",
            })),
          },
        },
      },
    ]);

    await orchestrator.runTask(card.id);

    expect(harness.runner.injectedResults.at(0)?.result).toMatch(/may spawn 8 collaborators/);
    expect(await tasks.list(projectId)).toHaveLength(1);
  });

  /**
   * Codex, review round eight: a goal session that spawns escapes every rail
   * the goal has. Its subtasks run as ordinary task sessions — no budget, no
   * deadline — and outlive a goal that stopped.
   */
  it("refuses to spawn from a goal session, whatever the agent is allowed", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    await allowReviewers(projectId, agentIds["review-coordinator"]!, ["feasibility"]);

    harness.runner.setScript([
      {
        kind: "tool",
        call: {
          name: "agentos_spawn_collaborators",
          input: { collaborators: [{ agent: "feasibility", name: "Review", brief: "look" }] },
        },
      },
    ]);

    await orchestrator.runGoalStep({
      goalId: randomUUID(),
      projectId,
      agentName: "review-coordinator",
      brief: "coordinate",
      budgetUsd: 5,
    });

    expect(harness.runner.injectedResults.at(0)?.result).toMatch(/goal session may not spawn/);
    expect(await tasks.list(projectId)).toHaveLength(0);
  });

  it("refuses to read a subtask this session did not spawn", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    await allowReviewers(projectId, agentIds["review-coordinator"]!, ["feasibility"]);
    const card = await coordinatorTask(projectId, agentIds["review-coordinator"]!);
    const other = await coordinatorTask(projectId, agentIds.default!, "Someone else's card");

    harness.runner.setScript([
      { kind: "tool", call: { name: "agentos_read_subtask", input: { taskId: other.id } } },
    ]);

    await orchestrator.runTask(card.id);

    expect(harness.runner.injectedResults.at(0)?.result).toMatch(/no subtask/);
  });
});

/** Waits for the spawn to have created its cards, without a fixed sleep. */
async function waitForSpawned(
  tasks: TasksService,
  projectId: string,
  parentTaskId: string,
  expected: number,
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const all = await tasks.list(projectId);
    const spawned = all.filter((task) => task.parentTaskId === parentTaskId);
    if (spawned.length >= expected) {
      return spawned;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`only saw fewer than ${expected} spawned subtasks`);
}
