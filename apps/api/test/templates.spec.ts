import { COMPOUND_ENGINEER_TEMPLATE } from "@agentos/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SessionQueue } from "../src/queue/session.queue";
import { TasksService } from "../src/tasks/tasks.service";
import { TemplatesService } from "../src/templates/templates.service";
import { createHarness, type Harness } from "./harness";

/**
 * Phase 3 done-when (SPEC §21) and acceptance test §22.6.
 *
 * The queue is spied rather than run: what matters is *which* step the chain
 * releases and when, not that a container came up.
 */
describe("template chains", () => {
  let harness: Harness;
  let templates: TemplatesService;
  let tasks: TasksService;
  let enqueued: string[];

  beforeAll(async () => {
    harness = await createHarness();
    templates = harness.app.get(TemplatesService);
    tasks = harness.app.get(TasksService);

    const queue = harness.app.get(SessionQueue);
    // Record releases instead of running them.
    queue.enqueueRun = async (taskId: string) => {
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

  it("creates all nine cards in order with variables interpolated", async () => {
    const { projectId } = await harness.seedProject();
    const [template] = await templates.installBuiltIns(projectId);

    const created = await templates.instantiate(projectId, template!.id, {
      variables: { branchName: "feat/onboarding", feature: "operator onboarding" },
      titlePrefix: "",
    });

    expect(created).toHaveLength(9);
    expect(created.map((task) => task.chainIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(new Set(created.map((task) => task.chainId)).size).toBe(1);

    expect(created[0]!.description).toContain("operator onboarding");
    expect(created[0]!.description).not.toContain("{{feature}}");
    expect(created[4]!.description).toContain("feat/onboarding");

    // The spec step and the human PR step are the two gates.
    expect(created.filter((task) => task.approvalGate).map((task) => task.chainIndex)).toEqual([0, 8]);
    expect(created[8]!.assigneeType).toBe("human");

    // Only step 0 was released.
    expect(enqueued).toEqual([created[0]!.id]);
  });

  it("does not release step 1 until the operator closes the gated step 0", async () => {
    const { projectId } = await harness.seedProject();
    const [template] = await templates.installBuiltIns(projectId);
    const created = await templates.instantiate(projectId, template!.id, {
      variables: { branchName: "feat/x", feature: "x" },
      titlePrefix: "",
    });
    enqueued = [];

    // The agent can move the gated card to review but not past it.
    await tasks.setStatusFromAgent(created[0]!.id, "review");
    expect(enqueued).toEqual([]);
    await expect(tasks.setStatusFromAgent(created[0]!.id, "done")).rejects.toThrow(
      /approval-gated/,
    );
    expect(enqueued).toEqual([]);

    // The operator closes it, and only then does step 1 run.
    await tasks.patch(projectId, created[0]!.id, { status: "done" }, "human");
    expect(enqueued).toEqual([created[1]!.id]);
  });

  it("releases each following step exactly once, and stops at the human step", async () => {
    const { projectId } = await harness.seedProject();
    const [template] = await templates.installBuiltIns(projectId);
    const created = await templates.instantiate(projectId, template!.id, {
      variables: { branchName: "feat/x", feature: "x" },
      titlePrefix: "",
    });
    await tasks.patch(projectId, created[0]!.id, { status: "done" }, "human");
    enqueued = [];

    // Steps 1..7 are agent steps; each completion releases the next.
    for (let index = 1; index <= 7; index += 1) {
      await tasks.setStatusFromAgent(created[index]!.id, "done");
    }

    expect(enqueued).toEqual(created.slice(2, 9).map((task) => task.id).slice(0, 6));
    // Step 8 is the operator's own card: it is never auto-released.
    expect(enqueued).not.toContain(created[8]!.id);
  });

  it("releases the next step once, even if a card is closed twice", async () => {
    const { projectId } = await harness.seedProject();
    const [template] = await templates.installBuiltIns(projectId);
    const created = await templates.instantiate(projectId, template!.id, {
      variables: { branchName: "feat/x", feature: "x" },
      titlePrefix: "",
    });
    enqueued = [];

    // A double click, or a retried request, must not run step 1 twice.
    await tasks.patch(projectId, created[0]!.id, { status: "done" }, "human");
    await tasks.patch(projectId, created[0]!.id, { status: "done" }, "human");

    expect(enqueued).toEqual([created[1]!.id]);
  });

  it("refuses to instantiate when a declared variable is missing", async () => {
    const { projectId } = await harness.seedProject();
    const [template] = await templates.installBuiltIns(projectId);

    await expect(
      templates.instantiate(projectId, template!.id, {
        variables: { feature: "x" },
        titlePrefix: "",
      }),
    ).rejects.toThrow(/branchName/);
  });

  it("ships the template the spec describes", async () => {
    expect(COMPOUND_ENGINEER_TEMPLATE.steps).toHaveLength(9);
    expect(COMPOUND_ENGINEER_TEMPLATE.steps.map((step) => step.agentName)).toEqual([
      "spec",
      "plan",
      "review-coordinator",
      "plan",
      "implementation-plan-executioner",
      "review-coordinator",
      "senior-dev",
      "librarian",
      "human",
    ]);
    // The fourth plan reviewer is named in the coordinator's brief.
    expect(COMPOUND_ENGINEER_TEMPLATE.steps[2]!.prompt).toContain("plan-risk");
  });
});
