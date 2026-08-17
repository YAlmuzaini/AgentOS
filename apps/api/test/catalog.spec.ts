import { agents as agentsTable, mcpConnections, skills as skillsTable } from "@agentos/db";
import {
  BUILT_IN_MCP,
  BUILT_IN_TEMPLATES,
  CATALOG_PACKS,
  MCP_CATALOG,
  BUILT_IN_SKILLS,
  builtInRoleInstalls,
  CATEGORIES,
  createAgentSchema,
  createMcpConnectionSchema,
  documentAgentSchema,
  documentMcpSchema,
  isCategory,
  ROLE_SEEDS,
} from "@agentos/shared";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AgentsService } from "../src/agents/agents.service";
import { SecretsService } from "../src/secrets/secrets.service";
import { CatalogService } from "../src/resources/catalog.service";
import { createHarness, type Harness } from "./harness";

/**
 * The shipped catalogue — roles, skills and MCP connections — and the rules
 * that make it safe to install into a project that already has work in it.
 *
 * The catalogue is data, and data with no test is data that rots: a role whose
 * collaboration list names an agent nobody ships is a spawn that fails at 3am,
 * and a category typo is an agent that disappears from every filtered view.
 */
describe("the shipped catalogue", () => {
  let harness: Harness;
  let agents: AgentsService;
  let catalog: CatalogService;

  beforeAll(async () => {
    harness = await createHarness();
    agents = harness.app.get(AgentsService);
    catalog = harness.app.get(CatalogService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
  });

  /* ── The data itself ─────────────────────────────────────────────────── */

  it("gives every shipped role a unique name, a real category, and a description", () => {
    const names = ROLE_SEEDS.map((role) => role.name);
    expect(new Set(names).size).toBe(names.length);

    for (const role of ROLE_SEEDS) {
      expect(isCategory(role.category), `${role.name} category`).toBe(true);
      // The description is the sentence an operator reads while deciding who
      // takes a task. A role without one is invisible in a list of thirty.
      expect(role.description.trim().length, `${role.name} description`).toBeGreaterThan(20);
      expect(role.description.length, `${role.name} description length`).toBeLessThanOrEqual(1024);
      expect(role.rolePrompt.trim().length, `${role.name} prompt`).toBeGreaterThan(0);
      expect(role.title.trim().length, `${role.name} title`).toBeGreaterThan(0);
    }
  });

  /**
   * A collaboration list is spawn authorisation, and it is resolved by *name*
   * at dispatch. A name nobody ships is not a configuration error the operator
   * ever sees — it is a coordinator that spawns three of its four reviewers.
   */
  it("only lets a shipped role spawn other shipped roles", () => {
    const names = new Set(ROLE_SEEDS.map((role) => role.name));
    for (const role of ROLE_SEEDS) {
      for (const spawned of role.collaboration ?? []) {
        expect(names.has(spawned), `${role.name} spawns ${spawned}`).toBe(true);
      }
      // And nobody spawns themselves, which is a loop with a spend cap on it.
      expect(role.collaboration ?? []).not.toContain(role.name);
    }
  });

  it("gives every shipped skill a unique slug, a real category, and a description", () => {
    const slugs = BUILT_IN_SKILLS.map((skill) => skill.slug);
    expect(new Set(slugs).size).toBe(slugs.length);

    for (const skill of BUILT_IN_SKILLS) {
      expect(isCategory(skill.category), `${skill.slug} category`).toBe(true);
      expect(skill.description.trim().length, `${skill.slug} description`).toBeGreaterThan(20);
      expect(skill.description.length, `${skill.slug} description`).toBeLessThanOrEqual(1024);
      // Every shipped skill is a prompt, and its body is inlined into the
      // system prompt of every session that holds it — so a shipped skill that
      // is longer than a page is a tax on every run.
      expect(skill.kind).toBe("prompt");
      expect(skill.body.trim().length, `${skill.slug} body`).toBeGreaterThan(0);
      expect(skill.body.length, `${skill.slug} body length`).toBeLessThan(2000);
    }
  });

  /**
   * Both runners can carry exactly one shape of MCP server: a remote URL with
   * an optional bearer token. An entry that needs stdio or OAuth would be a
   * connection an operator installs, grants, and then watches fail on its first
   * call — so the constraint is asserted here rather than documented and hoped
   * for.
   */
  it("ships only remote HTTPS connections whose hosts are declared", () => {
    const slugs = BUILT_IN_MCP.map((entry) => entry.slug);
    expect(new Set(slugs).size).toBe(slugs.length);

    for (const entry of BUILT_IN_MCP) {
      const url = new URL(entry.url);
      expect(url.protocol, `${entry.slug} protocol`).toBe("https:");
      // The environment allowlist is a second, independent wall, and it is
      // keyed by hostname. An undeclared host is a connection the operator
      // cannot make reachable without reading our source.
      expect(entry.hosts, `${entry.slug} hosts`).toContain(url.hostname);
      expect(isCategory(entry.category), `${entry.slug} category`).toBe(true);
      expect(entry.description.trim().length, `${entry.slug} description`).toBeGreaterThan(20);
      expect(entry.docs.trim().length, `${entry.slug} docs`).toBeGreaterThan(20);
      if (entry.credentialEnvVar !== null) {
        expect(entry.credentialEnvVar, `${entry.slug} env var`).toMatch(/^[A-Z][A-Z0-9_]*$/);
      }
    }
  });

  /** Both doors validate a category, so `agentos push` is not the way around it. */
  it("refuses a category neither door recognises", () => {
    const agent = {
      name: "release",
      title: "Release",
      model: "claude-sonnet-5",
      rolePrompt: "Ship it.",
    };
    expect(createAgentSchema.safeParse({ ...agent, category: "devops" }).success).toBe(true);
    expect(createAgentSchema.safeParse({ ...agent, category: "wizardry" }).success).toBe(false);
    expect(
      documentAgentSchema.safeParse({
        title: "Release",
        model: "claude-sonnet-5",
        prompt: "Ship it.",
        category: "wizardry",
      }).success,
    ).toBe(false);
    // Absent is legal at both doors and lands in `general`.
    expect(createAgentSchema.parse(agent).category).toBe("general");
    expect(CATEGORIES).toContain("general");
  });

  /* ── Installing it ───────────────────────────────────────────────────── */

  it("installs every shipped role with its description and category", async () => {
    // A bare project, so this exercises the installer rather than the seed.
    const [project] = await harness.db.execute<{ id: string }>(
      sql`INSERT INTO projects (name, slug) VALUES ('Fresh', 'fresh') RETURNING id`,
    );
    const projectId = project!.id;

    const installed = await agents.installBuiltIns(projectId);
    expect(installed).toHaveLength(builtInRoleInstalls().length);

    for (const role of installed) {
      const seed = ROLE_SEEDS.find((candidate) => candidate.name === role.name)!;
      expect(seed).toBeDefined();
      expect(role.description).toBe(seed.description);
      expect(role.category).toBe(seed.category);
    }

    // Installing again changes nothing and duplicates nothing.
    const again = await agents.installBuiltIns(projectId);
    expect(again).toHaveLength(installed.length);
    const rows = await harness.db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.projectId, projectId));
    expect(rows).toHaveLength(installed.length);
  });

  /**
   * The provenance rule, restated for the two new columns: an operator's own
   * agent that happens to share a built-in name keeps its own text. The
   * installer refreshes only rows it created.
   */
  it("leaves an operator's own agent of the same name alone", async () => {
    const { projectId } = await harness.seedProject();
    await harness.db
      .update(agentsTable)
      .set({ builtIn: false, description: "mine", category: "general" })
      .where(and(eq(agentsTable.projectId, projectId), eq(agentsTable.name, "plan")));

    await agents.installBuiltIns(projectId);

    const mine = await harness.db.query.agents.findFirst({
      where: and(eq(agentsTable.projectId, projectId), eq(agentsTable.name, "plan")),
    });
    expect(mine!.description).toBe("mine");
    expect(mine!.category).toBe("general");
  });

  it("installs the shipped skills with their description and category, and is idempotent", async () => {
    const { projectId } = await harness.seedProject();

    const installed = await catalog.installBuiltInSkills(projectId);
    expect(installed).toHaveLength(BUILT_IN_SKILLS.length);
    for (const skill of installed) {
      const seed = BUILT_IN_SKILLS.find((candidate) => candidate.slug === skill.slug)!;
      expect(skill.description).toBe(seed.description);
      expect(skill.category).toBe(seed.category);
    }

    const again = await catalog.installBuiltInSkills(projectId);
    expect(again).toHaveLength(BUILT_IN_SKILLS.length);
    expect((await catalog.listSkills(projectId)).length).toBe(BUILT_IN_SKILLS.length);
  });

  /**
   * The provenance rule for skills, which is narrower than the one for agents:
   * the installer refreshes only the metadata it authors, and only on rows it
   * created. A skill's *body* is never replaced — an operator who tightened a
   * built-in's instructions keeps them.
   */
  it("refreshes a built-in skill's metadata but never its instructions", async () => {
    const { projectId } = await harness.seedProject();
    await catalog.installBuiltInSkills(projectId);

    // An operator edits a built-in's body, and blanks its metadata.
    await harness.db
      .update(skillsTable)
      .set({ body: "my own instructions", description: "", category: "general" })
      .where(and(eq(skillsTable.projectId, projectId), eq(skillsTable.slug, "plan-mode")));

    // …and writes a skill of their own that happens to share a shipped slug.
    await harness.db
      .update(skillsTable)
      .set({ builtIn: false, description: "mine", category: "general" })
      .where(and(eq(skillsTable.projectId, projectId), eq(skillsTable.slug, "e2e-first")));

    await catalog.installBuiltInSkills(projectId);

    const planMode = await harness.db.query.skills.findFirst({
      where: and(eq(skillsTable.projectId, projectId), eq(skillsTable.slug, "plan-mode")),
    });
    // Metadata came back; the operator's instructions did not get overwritten.
    expect(planMode!.category).toBe(
      BUILT_IN_SKILLS.find((skill) => skill.slug === "plan-mode")!.category,
    );
    expect(planMode!.description.length).toBeGreaterThan(0);
    expect(planMode!.body).toBe("my own instructions");

    const theirs = await harness.db.query.skills.findFirst({
      where: and(eq(skillsTable.projectId, projectId), eq(skillsTable.slug, "e2e-first")),
    });
    expect(theirs!.description).toBe("mine");
    expect(theirs!.category).toBe("general");
  });

  /**
   * The property that makes the MCP catalogue safe to install on a project
   * that is already running: it is nine inert rows. Default deny means a
   * connection reaches a session only when an agent lists its id, and installing
   * lists nothing.
   */
  it("installs MCP connections that no agent can yet reach", async () => {
    const { projectId } = await harness.seedProject();

    const installed = await catalog.installBuiltInMcp(projectId);
    expect(installed).toHaveLength(BUILT_IN_MCP.length);
    for (const connection of installed) {
      const seed = BUILT_IN_MCP.find((candidate) => candidate.slug === connection.name)!;
      expect(seed).toBeDefined();
      expect(connection.url).toBe(seed.url);
      // Nothing arrives with a credential: a reference we minted would resolve
      // to nothing and the manifest would silently drop the grant.
      expect(connection.credentialSecretId).toBeNull();
    }

    const granted = await harness.db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.projectId, projectId));
    for (const agent of granted) {
      expect(agent.mcpConnectionIds).toHaveLength(0);
    }
  });

  it("leaves an existing connection of the same name exactly as it is", async () => {
    const { projectId } = await harness.seedProject();
    const mine = await catalog.createMcp(projectId, {
      name: "github",
      url: "https://mcp.internal.example/github",
      allowedOperations: ["search_code"],
      credentialSecretId: null,
    });

    await catalog.installBuiltInMcp(projectId);

    const row = await harness.db.query.mcpConnections.findFirst({
      where: and(eq(mcpConnections.projectId, projectId), eq(mcpConnections.name, "github")),
    });
    expect(row!.id).toBe(mine.id);
    expect(row!.url).toBe("https://mcp.internal.example/github");
    expect(row!.allowedOperations).toEqual(["search_code"]);
    // …and the install still reports what is present rather than a short list.
    expect(await catalog.installBuiltInMcp(projectId)).toHaveLength(BUILT_IN_MCP.length);
  });

  /* ── MCP metadata, and the claims it is allowed to make ──────────────── */

  /**
   * Everything catalogued declares a transport and an auth kind this system can
   * actually carry. The list is small on purpose; an entry needing stdio or
   * OAuth would be installed, granted, and then fail on its first call.
   */
  it("declares a runnable transport and auth for every catalogued server", () => {
    for (const entry of MCP_CATALOG) {
      expect(entry.transport, entry.slug).toBe("http");
      expect(["none", "bearer"], entry.slug).toContain(entry.auth);
      expect(entry.cloudCompatible, entry.slug).toBe(true);
      expect(entry.localCompatible, entry.slug).toBe(true);
      // Claude Code attaches an MCP server whole; nothing catalogued may claim
      // otherwise, because the UI warns off this flag.
      expect(entry.localRequiresAllTools, entry.slug).toBe(true);
      expect(entry.risks.length, entry.slug).toBeGreaterThan(0);
      expect(entry.docsUrl, entry.slug).toMatch(/^https:\/\//);
      if (entry.auth === "none") {
        expect(entry.credentialEnvVar, entry.slug).toBeNull();
        expect(entry.credentialRequired, entry.slug).toBe(false);
      }
      if (entry.credentialRequired) {
        expect(entry.credentialEnvVar, entry.slug).not.toBeNull();
      }
    }
  });

  /**
   * The cost and blast-radius rail. `install-built-ins` is a button an operator
   * presses on a fresh project without reading nine vendor documents, so
   * nothing it creates may be able to spend their money or move their data.
   */
  it("never installs a mutating or high-risk server by default", () => {
    for (const entry of BUILT_IN_MCP) {
      expect(entry.installByDefault, entry.slug).toBe(true);
      expect(entry.risks, entry.slug).not.toContain("mutating");
      expect(entry.risks, entry.slug).not.toContain("high-risk");
    }
    // …and the ones that are excluded really are the dangerous ones, so this
    // does not pass by the catalogue quietly losing them.
    const optIn = MCP_CATALOG.filter((entry) => !entry.installByDefault).map((e) => e.slug);
    expect(optIn).toContain("stripe");
    expect(optIn).toContain("github-write");
    expect(optIn).toContain("apify-actors");
  });

  /**
   * The two hardened defaults, asserted as URLs rather than as intentions.
   * A future edit that "simplifies" either of these is a real regression:
   * GitHub's bare endpoint can open pull requests, and Apify's bare endpoint
   * can run Actors, which is billed to the operator.
   */
  it("defaults GitHub to the read-only endpoint and Apify to the free tools", () => {
    const github = BUILT_IN_MCP.find((entry) => entry.slug === "github-readonly")!;
    expect(github.url).toBe("https://api.githubcopilot.com/mcp/readonly");
    expect(github.risks).toContain("read-only");

    const apify = BUILT_IN_MCP.find((entry) => entry.slug === "apify-docs")!;
    expect(apify.url).toContain("tools=docs");
    expect(apify.url).toContain("telemetry-enabled=false");
    expect(apify.risks).not.toContain("billable");

    // The write-capable variants exist, and are not installed.
    expect(MCP_CATALOG.find((e) => e.slug === "github-write")!.url).toBe(
      "https://api.githubcopilot.com/mcp/",
    );
  });

  /* ── Editing a connection ────────────────────────────────────────────── */

  it("attaches a credential to an installed connection without granting it", async () => {
    const { projectId } = await harness.seedProject();
    await catalog.installBuiltInMcp(projectId);
    const [connection] = (await catalog.listMcp(projectId)).filter(
      (entry) => entry.name === "context7",
    );
    const secret = await harness.app
      .get(SecretsService)
      .create(projectId, { name: "c7", providerRef: "CONTEXT7_API_KEY", purpose: "mcp" });

    const updated = await catalog.updateMcp(projectId, connection!.id, {
      credentialSecretId: secret.id,
    });

    expect(updated.credentialSecretId).toBe(secret.id);
    // The URL the catalogue chose survives an update that did not mention it.
    expect(updated.url).toBe(connection!.url);
    // And still nobody can call it.
    const granted = await harness.db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.projectId, projectId));
    for (const agent of granted) {
      expect(agent.mcpConnectionIds).toHaveLength(0);
    }
  });

  /**
   * A git token posted to a third-party API is a credential leak built out of
   * two features that each look fine on their own.
   */
  it("refuses a secret that belongs to another purpose", async () => {
    const { projectId } = await harness.seedProject();
    const connection = await catalog.createMcp(projectId, {
      name: "custom",
      url: "https://mcp.example.invalid/mcp",
      allowedOperations: [],
      credentialSecretId: null,
    });
    const repoSecret = await harness.app
      .get(SecretsService)
      .create(projectId, { name: "gh", providerRef: "GITHUB_TOKEN", purpose: "repo" });

    await expect(
      catalog.updateMcp(projectId, connection.id, { credentialSecretId: repoSecret.id }),
    ).rejects.toThrow(/not mcp/);
  });

  /** Both doors, or it is not a rule. */
  it("refuses a wrong-purpose secret at creation too, not only on update", async () => {
    const { projectId } = await harness.seedProject();
    const repoSecret = await harness.app
      .get(SecretsService)
      .create(projectId, { name: "gh2", providerRef: "GITHUB_TOKEN", purpose: "repo" });

    await expect(
      catalog.createMcp(projectId, {
        name: "custom-create",
        url: "https://mcp.example.invalid/mcp",
        allowedOperations: [],
        credentialSecretId: repoSecret.id,
      }),
    ).rejects.toThrow(/not mcp/);
  });

  it("refuses a secret from another project", async () => {
    const { projectId } = await harness.seedProject();
    const [other] = await harness.db.execute<{ id: string }>(
      sql`INSERT INTO projects (name, slug) VALUES ('Other', 'other') RETURNING id`,
    );
    const foreign = await harness.app
      .get(SecretsService)
      .create(other!.id, { name: "theirs", providerRef: "THEIR_KEY", purpose: "mcp" });
    const connection = await catalog.createMcp(projectId, {
      name: "custom",
      url: "https://mcp.example.invalid/mcp",
      allowedOperations: [],
      credentialSecretId: null,
    });

    await expect(
      catalog.updateMcp(projectId, connection.id, { credentialSecretId: foreign.id }),
    ).rejects.toThrow();
  });

  /* ── Packs and recommended skills ────────────────────────────────────── */

  it("only lists roles the catalogue actually ships in every pack", () => {
    const shipped = new Set(ROLE_SEEDS.map((role) => role.name));
    const slugs = CATALOG_PACKS.map((pack) => pack.slug);
    expect(new Set(slugs).size).toBe(slugs.length);

    for (const pack of CATALOG_PACKS) {
      expect(pack.roles.length, pack.slug).toBeGreaterThan(0);
      for (const role of pack.roles) {
        expect(shipped.has(role), `${pack.slug} → ${role}`).toBe(true);
      }
    }
  });

  /**
   * The pack that has to be self-sufficient: every agent the built-in templates
   * dispatch to, and every specialist those coordinators may spawn.
   */
  it("gives core-engineering everything the built-in templates dispatch to", () => {
    const core = new Set(CATALOG_PACKS.find((pack) => pack.slug === "core-engineering")!.roles);
    for (const template of BUILT_IN_TEMPLATES) {
      for (const step of template.steps) {
        if (step.agentName === "human") {
          continue;
        }
        expect(core.has(step.agentName), `core-engineering → ${step.agentName}`).toBe(true);
      }
    }
    for (const name of core) {
      for (const spawned of ROLE_SEEDS.find((role) => role.name === name)?.collaboration ?? []) {
        expect(core.has(spawned), `core-engineering → ${spawned}`).toBe(true);
      }
    }
  });

  it("recommends only skills the catalogue ships", () => {
    const slugs = new Set(BUILT_IN_SKILLS.map((skill) => skill.slug));
    for (const role of ROLE_SEEDS) {
      for (const slug of role.recommendedSkills ?? []) {
        expect(slugs.has(slug), `${role.name} → ${slug}`).toBe(true);
      }
    }
  });

  it("installs a pack's roles and nothing else", async () => {
    const [project] = await harness.db.execute<{ id: string }>(
      sql`INSERT INTO projects (name, slug) VALUES ('Packs', 'packs') RETURNING id`,
    );
    const projectId = project!.id;

    const installed = await agents.installPack(projectId, "mobile");
    const pack = CATALOG_PACKS.find((entry) => entry.slug === "mobile")!;
    expect(installed.map((agent) => agent.name).sort()).toEqual([...pack.roles].sort());

    const rows = await harness.db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.projectId, projectId));
    expect(rows).toHaveLength(pack.roles.length);

    // A pack grants nothing that reaches outside the control plane: no
    // repository, no MCP connection, no folder, no environment (and therefore
    // no secret and no network).
    for (const row of rows) {
      expect(row.mcpConnectionIds).toHaveLength(0);
      expect(row.repoAccess).toHaveLength(0);
      expect(row.filesystemGrants).toHaveLength(0);
      expect(row.environmentId).toBeNull();
    }
  });

  /**
   * The two things a catalogue install *does* confer, stated as a test so the
   * documentation cannot drift away from them.
   *
   * A coordinator ships with the collaboration list its job requires — that is
   * spawn authorisation, and it is the whole reason the role exists — and a new
   * agent arrives with its recommended prompt skills. Neither reaches outside
   * AgentOS: a spawned agent gets its own grants, and a skill is text.
   */
  it("confers exactly two things: recommended skills, and a coordinator's own spawn list", async () => {
    const [project] = await harness.db.execute<{ id: string }>(
      sql`INSERT INTO projects (name, slug) VALUES ('Confer', 'confer') RETURNING id`,
    );
    const projectId = project!.id;
    await catalog.installBuiltInSkills(projectId);
    await agents.installPack(projectId, "core-engineering");

    const installed = await agents.list(projectId);
    const coordinator = installed.find((a) => a.name === "code-review-coordinator")!;
    expect(coordinator.collaborationList).toEqual([
      "security-reviewer",
      "test-auditor",
      "simplifier",
      "performance-reviewer",
    ]);

    // Everything a coordinator may spawn is in the same pack, so the authority
    // it is given is authority over agents that actually exist.
    for (const name of coordinator.collaborationList) {
      expect(installed.some((a) => a.name === name), name).toBe(true);
    }

    // A role with no coordinating job spawns nobody.
    expect(installed.find((a) => a.name === "senior-dev")!.collaborationList).toEqual([]);
    expect(installed.find((a) => a.name === "senior-dev")!.skillIds.length).toBeGreaterThan(0);
  });

  /**
   * Recommendations apply to a new agent and never correct an existing one —
   * the same rule the role prompt follows, for the same reason.
   */
  it("applies recommended skills on create and never on reinstall", async () => {
    const [project] = await harness.db.execute<{ id: string }>(
      sql`INSERT INTO projects (name, slug) VALUES ('Recs', 'recs') RETURNING id`,
    );
    const projectId = project!.id;
    await catalog.installBuiltInSkills(projectId);
    await agents.installBuiltIns(projectId);

    const skillsBySlug = new Map(
      (await catalog.listSkills(projectId)).map((skill) => [skill.slug, skill.id]),
    );
    const seniorDev = (await agents.list(projectId)).find((agent) => agent.name === "senior-dev")!;
    expect(seniorDev.skillIds).toContain(skillsBySlug.get("commit-discipline"));
    expect(seniorDev.skillIds).toContain(skillsBySlug.get("verification-loop"));

    // The operator removes one, deliberately.
    await agents.update(projectId, seniorDev.id, { skillIds: [] });
    await agents.installBuiltIns(projectId);

    const after = (await agents.list(projectId)).find((agent) => agent.name === "senior-dev")!;
    expect(after.skillIds).toEqual([]);
  });

  /** Agents installed before skills still work; the slugs are simply skipped. */
  it("skips recommendations for skills the project does not have", async () => {
    const [project] = await harness.db.execute<{ id: string }>(
      sql`INSERT INTO projects (name, slug) VALUES ('Bare', 'bare') RETURNING id`,
    );
    const installed = await agents.installBuiltIns(project!.id);
    for (const agent of installed) {
      expect(agent.skillIds).toEqual([]);
    }
  });

  /* ── The RAG capability ──────────────────────────────────────────────── */

  it("ships a RAG architect with its skills, granted nothing", () => {
    const role = ROLE_SEEDS.find((entry) => entry.name === "rag-engineering-architect")!;
    expect(role).toBeDefined();
    expect(role.category).toBe("data");
    expect(role.collaboration ?? []).toEqual([]);

    for (const slug of [
      "rag-architecture",
      "retrieval-evaluation",
      "rag-security",
      "document-ingestion-discipline",
    ]) {
      const skill = BUILT_IN_SKILLS.find((entry) => entry.slug === slug)!;
      expect(skill, slug).toBeDefined();
      // Inlined into every session that holds it, so it stays short.
      expect(skill.body.length, slug).toBeLessThan(2000);
      expect(role.recommendedSkills, slug).toContain(slug);
    }

    // It is in the data pack, and in no pack that would put it near production.
    const packs = CATALOG_PACKS.filter((pack) => pack.roles.includes(role.name)).map((p) => p.slug);
    expect(packs).toEqual(["data-rag"]);
  });

  /* ── Credentials must never live in a URL ────────────────────────────── */

  /**
   * Codex rounds six to eight. A URL is stored verbatim, returned by the API
   * and rendered on a screen, so a credential in one is a credential in the
   * database — and the verifier's later refusal is far too late to help.
   */
  it("refuses a credential embedded in an MCP URL, in every shape it takes", () => {
    const refused = [
      "https://user:s3cret@example.com/mcp",
      "https://example.com/mcp?api_key=s3cret",
      "https://example.com/mcp?api-key=s3cret",
      "https://example.com/mcp?client_secret=s3cret",
      "https://example.com/mcp?key=s3cret",
      "https://example.com/mcp?token=s3cret",
      "https://example.com/mcp?auth=s3cret",
      "https://example.com/mcp?exaApiKey=s3cret",
      // Compounds a fixed list would never finish enumerating.
      "https://example.com/mcp?apikey=s3cret",
      "https://example.com/mcp?refreshtoken=s3cret",
      "https://example.com/mcp?idtoken=s3cret",
      "https://example.com/mcp?jwttoken=s3cret",
      "https://example.com/mcp?clientsecret=s3cret",
      "https://example.com/mcp?privatekey=s3cret",
      // The OAuth implicit-flow shape, which reaches the database identically.
      "https://example.com/mcp#access_token=s3cret",
    ];
    for (const url of refused) {
      expect(
        createMcpConnectionSchema.safeParse({ name: "x", url }).success,
        url,
      ).toBe(false);
      expect(documentMcpSchema.safeParse({ url }).success, `yaml: ${url}`).toBe(false);
    }
  });

  /**
   * The other half, and the one a blunt rule breaks: ordinary configuration
   * whose name merely contains a credential word.
   */
  it("accepts configuration parameters that only look like credentials", () => {
    const accepted = [
      "https://example.com/mcp?authMode=none",
      "https://example.com/mcp?author=alice",
      "https://example.com/mcp?keyboardLayout=us",
      "https://example.com/mcp?keyspace=tenant_a",
      // Ends in nothing credential-shaped; starts with one.
      "https://example.com/mcp?tokenizer=bpe",
      // A malformed escape is a validation question, not an internal error.
      "https://example.com/mcp?fo%=x",
      ...MCP_CATALOG.map((entry) => entry.url),
    ];
    for (const url of accepted) {
      expect(createMcpConnectionSchema.safeParse({ name: "x", url }).success, url).toBe(true);
    }
  });
});