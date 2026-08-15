import { agentHomeFolder, authorizeFs, type FilesystemGrant } from "@agentos/shared";
import { agents } from "@agentos/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CatalogService } from "../src/resources/catalog.service";
import { SessionOrchestrator } from "../src/runner/session-orchestrator";
import { SecretsService } from "../src/secrets/secrets.service";
import { TasksService } from "../src/tasks/tasks.service";
import { createHarness, type Harness } from "./harness";

/**
 * Phase 2 done-when (SPEC §21) and acceptance tests §22.2, §22.3, §22.4, §22.13.
 *
 * The through-line: a capability that is not granted must be *absent from the
 * session manifest*, not merely unused. These assert on what the control plane
 * actually hands the runtime.
 */
describe("least privilege", () => {
  let harness: Harness;
  let orchestrator: SessionOrchestrator;
  let tasks: TasksService;
  let catalog: CatalogService;
  let secrets: SecretsService;

  beforeAll(async () => {
    harness = await createHarness();
    orchestrator = harness.app.get(SessionOrchestrator);
    tasks = harness.app.get(TasksService);
    catalog = harness.app.get(CatalogService);
    secrets = harness.app.get(SecretsService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
  });

  /** §22.2 — path traversal and verb checks are decided server-side. */
  describe("filesystem ACL", () => {
    const grants: FilesystemGrant[] = [
      { folderPath: "/wiki/", canRead: true, canWrite: true, canDelete: false },
      { folderPath: "/shared/", canRead: true, canWrite: false, canDelete: false },
    ];

    it("denies write without canWrite", () => {
      const decision = authorizeFs({
        agentSlug: "librarian",
        grants,
        operation: "write",
        path: "/shared/notes.md",
      });
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toMatch(/does not permit write/);
    });

    it("denies delete even where write is allowed", () => {
      const decision = authorizeFs({
        agentSlug: "librarian",
        grants,
        operation: "delete",
        path: "/wiki/page.md",
      });
      expect(decision.allowed).toBe(false);
    });

    it("rejects traversal rather than resolving it", () => {
      for (const path of ["/wiki/../etc/passwd", "/wiki/../../root", "wiki/page.md"]) {
        const decision = authorizeFs({ agentSlug: "librarian", grants, operation: "read", path });
        expect(decision.allowed, path).toBe(false);
      }
    });

    it("denies any path no grant covers", () => {
      const decision = authorizeFs({
        agentSlug: "librarian",
        grants,
        operation: "read",
        path: "/agents/senior-dev/secret.md",
      });
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toMatch(/no grant covers/);
    });

    it("gives every agent a read/write home folder that it cannot delete from", () => {
      const home = `${agentHomeFolder("librarian")}notes.md`;
      expect(authorizeFs({ agentSlug: "librarian", grants: [], operation: "write", path: home }).allowed).toBe(true);
      expect(authorizeFs({ agentSlug: "librarian", grants: [], operation: "delete", path: home }).allowed).toBe(false);
      // …and it is not another agent's home folder.
      expect(
        authorizeFs({
          agentSlug: "librarian",
          grants: [],
          operation: "read",
          path: `${agentHomeFolder("senior-dev")}notes.md`,
        }).allowed,
      ).toBe(false);
    });
  });

  /** §22.3 and §22.13 — ungranted capabilities never reach the manifest. */
  it("omits a project MCP connection the agent was not granted", async () => {
    const { projectId, agentIds } = await harness.seedProject();

    await catalog.createMcp(projectId, {
      name: "github",
      url: "https://api.githubcopilot.com/mcp/",
      allowedOperations: [],
      credentialSecretId: null,
    });

    const task = await createTask(tasks, projectId, agentIds.plan!);
    harness.runner.setScript([]);
    await orchestrator.runTask(task.id);

    const manifest = harness.runner.provisioned[0]!;
    expect(manifest.mcpServers).toHaveLength(0);
    expect(manifest.systemPrompt).not.toContain("github");
  });

  it("attaches only the connection the agent lists, with its credential", async () => {
    const { projectId, agentIds } = await harness.seedProject();

    process.env.FRONT_TOKEN = "front-secret-value";
    const secret = await secrets.create(projectId, {
      name: "front-token",
      providerRef: "FRONT_TOKEN",
      purpose: "mcp",
    });
    const front = await catalog.createMcp(projectId, {
      name: "front",
      url: "https://api.front.com/mcp",
      allowedOperations: ["list_conversations"],
      credentialSecretId: secret.id,
    });
    await catalog.createMcp(projectId, {
      name: "ahrefs",
      url: "https://ahrefs.example/mcp",
      allowedOperations: [],
      credentialSecretId: null,
    });

    await harness.db
      .update(agents)
      .set({ mcpConnectionIds: [front.id] })
      .where(eq(agents.id, agentIds["customer-support"] ?? agentIds.default!));

    const task = await createTask(tasks, projectId, agentIds["customer-support"] ?? agentIds.default!);
    harness.runner.setScript([]);
    await orchestrator.runTask(task.id);

    const manifest = harness.runner.provisioned[0]!;
    expect(manifest.mcpServers.map((server) => server.name)).toEqual(["front"]);
    expect(manifest.mcpServers[0]!.token).toBe("front-secret-value");
    expect(manifest.repos).toHaveLength(0);
    expect(JSON.stringify(manifest.mcpServers)).not.toContain("ahrefs");
  });

  /** §22.4 — the network wall is a second, independent deny. */
  it("defaults to a deny-all network policy when the agent names no environment", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const task = await createTask(tasks, projectId, agentIds.plan!);
    harness.runner.setScript([]);
    await orchestrator.runTask(task.id);

    const manifest = harness.runner.provisioned[0]!;
    expect(manifest.environment.networking).toBe("limited");
    expect(manifest.environment.allowedHosts).toEqual([]);
    expect(manifest.systemPrompt).toContain("restricted");
  });

  it("carries the environment's allowlist and nothing else", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const { EnvironmentsService } = await import("../src/resources/environments.service");
    const environments = harness.app.get(EnvironmentsService);
    const limited = await environments.create(projectId, {
      name: "front-only",
      networking: "limited",
      allowedHosts: ["api.front.com"],
    });

    await harness.db
      .update(agents)
      .set({ environmentId: limited.id })
      .where(eq(agents.id, agentIds.default!));

    const task = await createTask(tasks, projectId, agentIds.default!);
    harness.runner.setScript([]);
    await orchestrator.runTask(task.id);

    const manifest = harness.runner.provisioned[0]!;
    expect(manifest.environment.allowedHosts).toEqual(["api.front.com"]);
    expect(manifest.environment.allowedHosts).not.toContain("github.com");
  });

  /**
   * SPEC §5.6 — a secret reaches a session "only if the agent/environment lists
   * them". The resolver used to select every binding in the project, so an
   * agent in the most restricted environment still received production
   * credentials. Regression guard for that.
   */
  it("injects only the env vars belonging to the agent's own environment", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const { EnvironmentsService } = await import("../src/resources/environments.service");
    const environments = harness.app.get(EnvironmentsService);

    const staging = await environments.create(projectId, {
      name: "staging-only",
      networking: "limited",
      allowedHosts: ["api.staging.example"],
    });
    const production = await environments.create(projectId, {
      name: "production-only",
      networking: "limited",
      allowedHosts: ["api.production.example"],
    });

    process.env.STAGING_TOKEN = "staging-value";
    process.env.PRODUCTION_TOKEN = "production-value";
    const stagingSecret = await secrets.create(projectId, {
      name: "staging-token",
      providerRef: "STAGING_TOKEN",
      purpose: "env",
    });
    const productionSecret = await secrets.create(projectId, {
      name: "production-token",
      providerRef: "PRODUCTION_TOKEN",
      purpose: "env",
    });

    // The same key in both environments — the case a project-wide unique index
    // made impossible and a project-wide lookup made dangerous.
    await catalog.createEnvBinding(projectId, {
      environmentId: staging.id,
      key: "API_TOKEN",
      secretId: stagingSecret.id,
      allowedHosts: [],
    });
    await catalog.createEnvBinding(projectId, {
      environmentId: production.id,
      key: "API_TOKEN",
      secretId: productionSecret.id,
      allowedHosts: [],
    });

    await harness.db
      .update(agents)
      .set({ environmentId: staging.id })
      .where(eq(agents.id, agentIds.default!));

    const task = await createTask(tasks, projectId, agentIds.default!);
    harness.runner.setScript([]);
    await orchestrator.runTask(task.id);

    const manifest = harness.runner.provisioned[0]!;
    expect(manifest.envVars).toHaveLength(1);
    expect(manifest.envVars[0]!.key).toBe("API_TOKEN");
    expect(manifest.envVars[0]!.value).toBe("staging-value");
    expect(JSON.stringify(manifest.envVars)).not.toContain("production-value");
  });

  it("refuses a filesystem tool call the agent has no grant for", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const task = await createTask(tasks, projectId, agentIds.default!);

    harness.runner.setScript([
      { kind: "tool", call: { name: "fs_write", input: { path: "/wiki/x.md", content: "hi" } } },
      { kind: "tool", call: { name: "fs_write", input: { path: "/agents/default/x.md", content: "hi" } } },
      { kind: "tool", call: { name: "fs_delete", input: { path: "/agents/default/x.md" } } },
    ]);
    await orchestrator.runTask(task.id);

    const [ungranted, home, deletion] = harness.runner.injectedResults;
    expect(ungranted!.result).toMatch(/refused: no grant covers/);
    expect(home!.result).toMatch(/wrote/);
    expect(deletion!.result).toMatch(/refused/);
  });
});

async function createTask(tasks: TasksService, projectId: string, agentId: string) {
  return tasks.create(projectId, {
    name: "Task",
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
