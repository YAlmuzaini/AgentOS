import { agents, skills, taskTemplates } from "@agentos/db";
import { and, eq, sql } from "drizzle-orm";
import { parse } from "yaml";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AgentsService } from "../src/agents/agents.service";
import { CatalogService } from "../src/resources/catalog.service";
import { TemplatesService } from "../src/templates/templates.service";
import { ProjectYamlService } from "../src/yaml/project-yaml.service";
import { createHarness, type Harness } from "./harness";

/** Phase 6 done-when (SPEC §21) and acceptance test §22.12. */
describe("agentos.yml", () => {
  let harness: Harness;
  let yaml: ProjectYamlService;
  let templates: TemplatesService;
  let agentsService: AgentsService;
  let catalog: CatalogService;

  beforeAll(async () => {
    harness = await createHarness();
    yaml = harness.app.get(ProjectYamlService);
    templates = harness.app.get(TemplatesService);
    agentsService = harness.app.get(AgentsService);
    catalog = harness.app.get(CatalogService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
  });

  it("round-trips: push then pull is identity", async () => {
    const { projectId } = await harness.seedProject();
    await templates.installBuiltIns(projectId);

    const first = await yaml.pull(projectId);
    await yaml.push(projectId, first);
    const second = await yaml.pull(projectId);

    expect(second).toBe(first);
    // …and a second push changes nothing either.
    await yaml.push(projectId, second);
    expect(await yaml.pull(projectId)).toBe(first);
  });

  it("creates a whole project from a hand-written document", async () => {
    const { projectId } = await harness.seedProject();
    await harness.db.delete(agents).where(eq(agents.projectId, projectId));

    const document = `
project: test
environments:
  front-only:
    networking: limited
    allowedHosts:
      - api.front.com
secrets:
  front-token:
    providerRef: FRONT_TOKEN
    purpose: mcp
mcp:
  front:
    url: https://api.front.com/mcp
    credential: front-token
    allowedOperations:
      - list_conversations
agents:
  customer-support:
    title: Customer support
    model: claude-sonnet-5
    prompt: You handle inbound customer support.
    mcp:
      - front
    environment: front-only
    inbox: false
`;

    await yaml.push(projectId, document);

    const created = await agentsService.list(projectId);
    expect(created).toHaveLength(1);
    expect(created[0]!.name).toBe("customer-support");
    expect(created[0]!.inboxAccess).toBe(false);
    expect(created[0]!.mcpConnectionIds).toHaveLength(1);

    // The written document is what pull returns, semantically.
    const pulled = parse(await yaml.pull(projectId)) as Record<string, never>;
    expect(pulled).toMatchObject({
      project: "test",
      environments: { "front-only": { networking: "limited", allowedHosts: ["api.front.com"] } },
    });
  });

  it("reports what a push actually changed, not everything it touched", async () => {
    const { projectId } = await harness.seedProject();
    const document = await yaml.pull(projectId);

    // Re-pushing the same document changes nothing, and says so.
    const noop = await yaml.push(projectId, document);
    expect(noop.created).toEqual([]);
    expect(noop.updated).toEqual([]);
    expect(noop.skipped.length).toBeGreaterThan(0);

    // A new agent is created; an edited one is updated; the rest are untouched.
    const changed = document
      .replace("project: test", "project: test")
      .replace(
        "agents:\n",
        "agents:\n  scribe:\n    title: Scribe\n    model: claude-opus-5\n    prompt: Write things down.\n",
      )
      .replace("title: Librarian", "title: Chief librarian");

    const second = await yaml.push(projectId, changed);
    expect(second.created).toEqual(["agent:scribe"]);
    expect(second.updated).toEqual(["agent:librarian"]);
    expect(second.skipped).not.toContain("agent:scribe");
  });

  it("refuses a document whose agent references something it does not define", async () => {
    const { projectId } = await harness.seedProject();
    const document = `
project: test
agents:
  rogue:
    title: Rogue
    model: claude-opus-5
    prompt: hello
    mcp:
      - github
`;
    await expect(yaml.push(projectId, document)).rejects.toThrow(/mcp:github/);
  });

  it("refuses a document written for a different project", async () => {
    const { projectId } = await harness.seedProject();
    await expect(yaml.push(projectId, "project: someone-else\n")).rejects.toThrow(/someone-else/);
  });

  it("reports invalid documents with the offending path", async () => {
    const { projectId } = await harness.seedProject();
    await expect(
      yaml.push(projectId, "project: test\nagents:\n  broken:\n    title: x\n"),
    ).rejects.toThrow(/not valid/);
  });

  /**
   * Codex review, finding 10: a name the document references but never defines
   * used to resolve to `null`. That is not forgiving — a mistyped credential
   * became a connection with no credential, and a mistyped environment moved an
   * agent into the most restricted setting there is. Both silent, both found
   * later and for the wrong reason.
   */
  it("refuses a document that references a credential it does not define", async () => {
    const { projectId } = await harness.seedProject();
    await expect(
      yaml.push(
        projectId,
        `
project: test
mcp:
  front:
    url: https://api.front.com/mcp
    allowedOperations: []
    credential: front-tokne
`,
      ),
    ).rejects.toThrow(/front-tokne/);
  });

  it("refuses a document that puts an agent in an environment it does not define", async () => {
    const { projectId } = await harness.seedProject();
    await expect(
      yaml.push(
        projectId,
        `
project: test
agents:
  lonely:
    title: Lonely
    model: claude-sonnet-5
    prompt: Do the thing.
    environment: nowhere
`,
      ),
    ).rejects.toThrow(/nowhere/);
  });

  /** The new columns survive the round trip like every other field. */
  it("round-trips an agent's description, category and recommended skills", async () => {
    const { projectId } = await harness.seedProject();
    await templates.installBuiltIns(projectId);

    const document = `
project: test
skills:
  house-style:
    name: House style
    description: How we write things here, and when that matters.
    category: engineering
    kind: prompt
    body: Write plainly.
    filePath: null
agents:
  scribe:
    title: Scribe
    description: Writes the things nobody else will write.
    category: research
    model: claude-sonnet-5
    prompt: Write it down.
    skills:
      - house-style
    mcp: []
    repos: []
    filesystem: []
    collaboration: []
    environment: null
    runner: inherit
    inbox: true
`;
    await yaml.push(projectId, document);

    const pulled = await yaml.pull(projectId);
    expect(pulled).toContain("Writes the things nobody else will write.");
    expect(pulled).toContain("category: research");
    expect(pulled).toContain("house-style");

    // And the property that matters: pulling, pushing and pulling again is
    // stable, which is what makes the file safe to keep in git.
    await yaml.push(projectId, pulled);
    expect(await yaml.pull(projectId)).toBe(pulled);
  });

  it("round-trips installed pack and structured source provenance", async () => {
    const [project] = await harness.db.execute<{ id: string }>(
      sql`INSERT INTO projects (name, slug) VALUES ('Sources', 'sources') RETURNING id`,
    );
    await agentsService.installPack(project!.id, "mobile");
    const first = await yaml.pull(project!.id);
    expect(first).toContain("agentPacks:");
    expect(first).toContain("mobile:");
    expect(first).toContain("relationship: original");

    await yaml.push(project!.id, first);
    expect(await yaml.pull(project!.id)).toBe(first);
  });

  /**
   * A pull → push cycle used to convert the whole shipped catalogue into
   * operator-authored rows, because `builtIn` was absent from the document.
   * The next `installBuiltIns` would then refuse to update any of them.
   */
  it("round-trips catalogue ownership for agents, skills and workflows", async () => {
    const [project] = await harness.db.execute<{ id: string }>(
      sql`INSERT INTO projects (name, slug) VALUES ('Owned', 'owned') RETURNING id`,
    );
    const projectId = project!.id;
    await catalog.installBuiltInSkills(projectId);
    await agentsService.installBuiltIns(projectId, ["senior-dev"]);
    await templates.installBuiltIns(projectId, ["bugfix-workflow"]);

    const document = await yaml.pull(projectId);
    expect(document).toContain("builtIn: true");
    await yaml.push(projectId, document);

    const agentRow = await harness.db.query.agents.findFirst({ where: and(eq(agents.projectId, projectId), eq(agents.name, "senior-dev")) });
    const skillRow = await harness.db.query.skills.findFirst({ where: and(eq(skills.projectId, projectId), eq(skills.slug, "plan-mode")) });
    const templateRow = await harness.db.query.taskTemplates.findFirst({ where: and(eq(taskTemplates.projectId, projectId), eq(taskTemplates.name, "bugfix-workflow")) });
    expect(agentRow!.builtIn).toBe(true);
    expect(skillRow!.builtIn).toBe(true);
    expect(templateRow!.builtIn).toBe(true);
    expect(await yaml.pull(projectId)).toBe(document);

    // And an operator-authored row stays the operator's across the same cycle.
    const [mine] = await harness.db.insert(skills).values({
      projectId, name: "Mine", slug: "mine", description: "d", category: "general", kind: "prompt", body: "b", builtIn: false,
    }).returning();
    const withMine = await yaml.pull(projectId);
    await yaml.push(projectId, withMine);
    expect((await harness.db.query.skills.findFirst({ where: eq(skills.id, mine!.id) }))!.builtIn).toBe(false);
  });
});
