import { agents, skills, taskTemplates } from "@agentos/db";
import {
  BUILT_IN_TEMPLATES,
  LEGACY_BUILT_IN_TEMPLATE_SHAPES,
  matchesKnownBuiltInShape,
} from "@agentos/shared";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AgentsService } from "../src/agents/agents.service";
import { CatalogService } from "../src/resources/catalog.service";
import { TemplatesService } from "../src/templates/templates.service";
import { createHarness, type Harness } from "./harness";

const CURRENT = BUILT_IN_TEMPLATES.find((entry) => entry.name === "compound-engineer-workflow")!;
const LEGACY = LEGACY_BUILT_IN_TEMPLATE_SHAPES.find(
  (entry) => entry.name === "compound-engineer-workflow",
)!;

/**
 * What happens to rows that already exist when the catalogue changes shape.
 *
 * `built_in` arrived on `task_templates` in migration 0023 with a `false`
 * default, so every workflow installed before it reads as operator-authored —
 * and the installer, correctly, refuses to touch those. Without an adoption
 * pass a project upgraded from schema 22 keeps the miswired code-review step
 * for ever.
 */
describe("legacy built-in adoption and provenance refresh", () => {
  let harness: Harness;
  let templates: TemplatesService;
  let catalog: CatalogService;
  let agentsService: AgentsService;

  beforeAll(async () => {
    harness = await createHarness();
    templates = harness.app.get(TemplatesService);
    catalog = harness.app.get(CatalogService);
    agentsService = harness.app.get(AgentsService);
  });
  afterAll(async () => harness.close());
  beforeEach(async () => harness.reset());

  async function project(slug: string): Promise<string> {
    const [row] = await harness.db.execute<{ id: string }>(
      sql`INSERT INTO projects (name, slug) VALUES (${slug}, ${slug}) RETURNING id`,
    );
    return row!.id;
  }

  /** A row exactly as a pre-0023 install would have left it. */
  async function legacyRow(projectId: string, shape = LEGACY): Promise<string> {
    const [row] = await harness.db
      .insert(taskTemplates)
      .values({
        projectId,
        name: shape.name,
        description: shape.description,
        variables: shape.variables,
        steps: shape.steps,
        builtIn: false,
      })
      .returning();
    return row!.id;
  }

  it("recognises both the superseded and the current shape, and nothing else", () => {
    expect(matchesKnownBuiltInShape(LEGACY)).toBe(true);
    expect(matchesKnownBuiltInShape(CURRENT)).toBe(true);
    expect(
      matchesKnownBuiltInShape({ ...CURRENT, description: `${CURRENT.description} ` }),
    ).toBe(false);
    expect(
      matchesKnownBuiltInShape({
        ...CURRENT,
        steps: CURRENT.steps.map((step, index) =>
          index === 0 ? { ...step, prompt: `${step.prompt}!` } : step,
        ),
      }),
    ).toBe(false);
    // Name alone is never enough.
    expect(matchesKnownBuiltInShape({ ...CURRENT, steps: [CURRENT.steps[0]!] })).toBe(false);
  });

  it("adopts an unedited legacy row and gives it the corrected wiring", async () => {
    const projectId = await project("upgrade");
    const id = await legacyRow(projectId);
    expect((await harness.db.query.taskTemplates.findFirst({ where: eq(taskTemplates.id, id) }))!.steps[5]!.agentName).toBe("review-coordinator");

    await templates.installBuiltIns(projectId, ["compound-engineer-workflow"]);

    const after = (await harness.db.query.taskTemplates.findFirst({ where: eq(taskTemplates.id, id) }))!;
    expect(after.builtIn).toBe(true);
    expect(after.steps[5]!.agentName).toBe("code-review-coordinator");
    expect(after.provenance.relationship).toBe("original");
    // Adopted in place, not duplicated.
    expect(await harness.db.select().from(taskTemplates).where(eq(taskTemplates.projectId, projectId))).toHaveLength(1);
  });

  it("adopts a row that already matches the current shape without changing it", async () => {
    const projectId = await project("current");
    const id = await legacyRow(projectId, CURRENT);
    await templates.installBuiltIns(projectId, ["compound-engineer-workflow"]);
    const after = (await harness.db.query.taskTemplates.findFirst({ where: eq(taskTemplates.id, id) }))!;
    expect(after.builtIn).toBe(true);
    expect(after.steps).toEqual(CURRENT.steps);
  });

  it("leaves a partially customised legacy row alone, for ever", async () => {
    const projectId = await project("customised");
    const customised = {
      ...LEGACY,
      steps: LEGACY.steps.map((step, index) =>
        index === 1 ? { ...step, prompt: "Plan it my way." } : step,
      ),
    };
    const id = await legacyRow(projectId, customised);

    await templates.installBuiltIns(projectId, ["compound-engineer-workflow"]);
    await templates.installBuiltIns(projectId, ["compound-engineer-workflow"]);

    const after = (await harness.db.query.taskTemplates.findFirst({ where: eq(taskTemplates.id, id) }))!;
    expect(after.builtIn).toBe(false);
    expect(after.steps[1]!.prompt).toBe("Plan it my way.");
    expect(after.steps[5]!.agentName).toBe("review-coordinator");
  });

  it("leaves an operator-authored collision alone", async () => {
    const projectId = await project("collision");
    const [row] = await harness.db
      .insert(taskTemplates)
      .values({
        projectId,
        name: "compound-engineer-workflow",
        description: "My own thing that happens to share the name.",
        variables: ["x"],
        steps: [{ name: "Do it", agentName: "senior-dev", prompt: "go", approvalGate: false, attachmentsFromPrevious: false }],
        builtIn: false,
      })
      .returning();

    await templates.installBuiltIns(projectId);

    const after = (await harness.db.query.taskTemplates.findFirst({ where: eq(taskTemplates.id, row!.id) }))!;
    expect(after.builtIn).toBe(false);
    expect(after.steps).toHaveLength(1);
    expect(after.description).toBe("My own thing that happens to share the name.");
    // The other built-in still installs.
    expect(await harness.db.select().from(taskTemplates).where(eq(taskTemplates.projectId, projectId))).toHaveLength(2);
  });

  it("refreshes provenance on catalogue-owned skills and agents, not on operator rows", async () => {
    const projectId = await project("provenance");
    await catalog.installBuiltInSkills(projectId);
    await agentsService.installBuiltIns(projectId);

    // An upgrade from before the column existed: the row carries the default.
    await harness.db.update(skills).set({ provenance: { relationship: "original", canonicalUrl: null, marketplaceUrl: null, repositoryUrl: null, repositoryPath: null, version: null, commitSha: null, license: null, licenseUrl: null, contentHash: null, importedAt: null, lastUpstreamCheckAt: null, notes: null } }).where(and(eq(skills.projectId, projectId), eq(skills.slug, "rag-architecture")));
    const [operatorSkill] = await harness.db.insert(skills).values({
      projectId,
      name: "Mine",
      slug: "mine",
      description: "operator",
      category: "general",
      kind: "prompt",
      body: "mine",
      builtIn: false,
      provenance: { relationship: "original", canonicalUrl: null, marketplaceUrl: null, repositoryUrl: null, repositoryPath: null, version: null, commitSha: null, license: null, licenseUrl: null, contentHash: null, importedAt: null, lastUpstreamCheckAt: null, notes: "operator note" },
    }).returning();

    await catalog.installBuiltInSkills(projectId);
    await agentsService.installBuiltIns(projectId);

    const rag = (await harness.db.query.skills.findFirst({ where: and(eq(skills.projectId, projectId), eq(skills.slug, "rag-architecture")) }))!;
    expect(rag.provenance.relationship).toBe("inspired");
    expect(rag.provenance.repositoryUrl).toContain("sickn33/agentic-awesome-skills");
    // Original AgentOS content informed by research — never copied or adapted.
    expect(rag.provenance.notes).toMatch(/copied or adapted/i);
    expect(rag.provenance.notes).toContain("No prompt or skill was copied or adapted");

    const architect = (await harness.db.query.agents.findFirst({ where: and(eq(agents.projectId, projectId), eq(agents.name, "rag-engineering-architect")) }))!;
    expect(architect.provenance.relationship).toBe("inspired");

    const mine = (await harness.db.query.skills.findFirst({ where: eq(skills.id, operatorSkill!.id) }))!;
    expect(mine.provenance.notes).toBe("operator note");
  });
});
