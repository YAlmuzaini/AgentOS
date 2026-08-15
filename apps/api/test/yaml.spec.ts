import { agents } from "@agentos/db";
import { eq } from "drizzle-orm";
import { parse } from "yaml";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AgentsService } from "../src/agents/agents.service";
import { TemplatesService } from "../src/templates/templates.service";
import { ProjectYamlService } from "../src/yaml/project-yaml.service";
import { createHarness, type Harness } from "./harness";

/** Phase 6 done-when (SPEC §21) and acceptance test §22.12. */
describe("agentos.yml", () => {
  let harness: Harness;
  let yaml: ProjectYamlService;
  let templates: TemplatesService;
  let agentsService: AgentsService;

  beforeAll(async () => {
    harness = await createHarness();
    yaml = harness.app.get(ProjectYamlService);
    templates = harness.app.get(TemplatesService);
    agentsService = harness.app.get(AgentsService);
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
});
