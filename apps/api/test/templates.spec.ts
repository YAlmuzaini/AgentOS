import { BUILT_IN_TEMPLATES, ROLE_SEEDS, COMPOUND_ENGINEER_TEMPLATE } from "@agentos/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TasksService } from "../src/tasks/tasks.service";
import { TemplatesService } from "../src/templates/templates.service";
import { createHarness, type Harness } from "./harness";
import { stubQueue, type QueueSink } from "./queue-stub";

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
  let queued: QueueSink;

  beforeAll(async () => {
    harness = await createHarness();
    templates = harness.app.get(TemplatesService);
    tasks = harness.app.get(TasksService);

    // Records releases instead of running them, and validates the dedupe key
    // exactly as the real queue does — a stub that ignored it is how an
    // invalid BullMQ job id once reached production with the suite green.
    queued = stubQueue(harness);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    queued.clear();
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
    expect(queued.runs).toEqual([created[0]!.id]);
  });

  it("does not release step 1 until the operator closes the gated step 0", async () => {
    const { projectId } = await harness.seedProject();
    const [template] = await templates.installBuiltIns(projectId);
    const created = await templates.instantiate(projectId, template!.id, {
      variables: { branchName: "feat/x", feature: "x" },
      titlePrefix: "",
    });
    queued.clear();

    // The agent can move the gated card to review but not past it.
    await tasks.setStatusFromAgent(created[0]!.id, "review");
    expect(queued.runs).toEqual([]);
    await expect(tasks.setStatusFromAgent(created[0]!.id, "done")).rejects.toThrow(
      /approval-gated/,
    );
    expect(queued.runs).toEqual([]);

    // The operator closes it, and only then does step 1 run.
    await tasks.patch(projectId, created[0]!.id, { status: "done" }, "human");
    expect(queued.runs).toEqual([created[1]!.id]);
  });

  it("releases each following step exactly once, and stops at the human step", async () => {
    const { projectId } = await harness.seedProject();
    const [template] = await templates.installBuiltIns(projectId);
    const created = await templates.instantiate(projectId, template!.id, {
      variables: { branchName: "feat/x", feature: "x" },
      titlePrefix: "",
    });
    await tasks.patch(projectId, created[0]!.id, { status: "done" }, "human");
    queued.clear();

    // Steps 1..7 are agent steps; each completion releases the next.
    for (let index = 1; index <= 7; index += 1) {
      await tasks.setStatusFromAgent(created[index]!.id, "done");
    }

    expect(queued.runs).toEqual(created.slice(2, 9).map((task) => task.id).slice(0, 6));
    // Step 8 is the operator's own card: it is never auto-released.
    expect(queued.runs).not.toContain(created[8]!.id);
  });

  it("releases the next step once, even if a card is closed twice", async () => {
    const { projectId } = await harness.seedProject();
    const [template] = await templates.installBuiltIns(projectId);
    const created = await templates.instantiate(projectId, template!.id, {
      variables: { branchName: "feat/x", feature: "x" },
      titlePrefix: "",
    });
    queued.clear();

    // A double click, or a retried request, must not run step 1 twice.
    await tasks.patch(projectId, created[0]!.id, { status: "done" }, "human");
    await tasks.patch(projectId, created[0]!.id, { status: "done" }, "human");

    expect(queued.runs).toEqual([created[1]!.id]);
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
      // The *code* coordinator. Both steps used to name `review-coordinator`,
      // whose collaboration list is the four plan lenses — so the code review
      // step instructed a coordinator to spawn specialists it had no
      // authorisation to spawn, and it spawned nobody.
      "code-review-coordinator",
      "senior-dev",
      "librarian",
      "human",
    ]);
    // The fourth plan reviewer is named in the coordinator's brief.
    expect(COMPOUND_ENGINEER_TEMPLATE.steps[2]!.prompt).toContain("plan-risk");
  });

  /**
   * The wiring, checked against the shipped catalogue rather than by eye.
   *
   * A template step names an agent by string, and a name nobody ships is a
   * chain that fails at dispatch — hours into a run, on a card the operator
   * has stopped watching.
   */
  it("dispatches every template step to an agent the catalogue ships", () => {
    const shipped = new Set(ROLE_SEEDS.map((role) => role.name));
    for (const template of BUILT_IN_TEMPLATES) {
      for (const step of template.steps) {
        // `human` is the approval gate, not an agent.
        if (step.agentName === "human") {
          continue;
        }
        expect(shipped.has(step.agentName), `${template.name} → ${step.agentName}`).toBe(true);
      }
    }
  });

  it("uses the plan coordinator for plan review and the code coordinator for code review", () => {
    const byName = (name: string) =>
      COMPOUND_ENGINEER_TEMPLATE.steps.find((step) => step.name === name)!;
    expect(byName("Plan review").agentName).toBe("review-coordinator");
    expect(byName("Code review").agentName).toBe("code-review-coordinator");
  });

  /**
   * A coordinator's brief has to name specialists its collaboration list
   * actually authorises. Naming one it cannot spawn produces a report written
   * from the coordinator's own reading, which looks exactly like a real review.
   */
  it("only asks a coordinator to spawn specialists it is authorised to spawn", () => {
    const coordinators = [
      { step: "Plan review", agent: "review-coordinator" },
      { step: "Code review", agent: "code-review-coordinator" },
    ];

    for (const { step, agent } of coordinators) {
      const role = ROLE_SEEDS.find((candidate) => candidate.name === agent)!;
      const authorised = role.collaboration ?? [];
      expect(authorised.length, `${agent} has no collaboration list`).toBeGreaterThan(0);

      const prompt = COMPOUND_ENGINEER_TEMPLATE.steps.find((s) => s.name === step)!.prompt;

      // Every authorised specialist is actually named in the brief, so the
      // coordinator is not left to guess which of its four lenses to use.
      for (const spawned of authorised) {
        expect(prompt, `${step} should name ${spawned}`).toContain(spawned);
        expect(ROLE_SEEDS.some((r) => r.name === spawned), `${agent} spawns ${spawned}`).toBe(true);
      }

      // And the brief names nobody it cannot spawn. Only hyphenated role names
      // are checked: `plan`, `spec` and `verifier` are ordinary English in
      // these briefs, and matching them as identifiers tests the prose rather
      // than the wiring.
      const unambiguous = ROLE_SEEDS.map((r) => r.name).filter((name) => name.includes("-"));
      for (const named of unambiguous) {
        if (named === agent || !new RegExp(`\\b${named}\\b`).test(prompt)) {
          continue;
        }
        expect(authorised, `${step} names ${named}`).toContain(named);
      }
    }
  });
});
