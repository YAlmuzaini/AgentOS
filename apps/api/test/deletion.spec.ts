import { agents, repos, sessions, skills } from "@agentos/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AgentsService } from "../src/agents/agents.service";
import { ProjectsService } from "../src/projects/projects.service";
import { CatalogService } from "../src/resources/catalog.service";
import { DeletionService } from "../src/resources/deletion.service";
import { FilesService } from "../src/files/files.service";
import { AutomationsService } from "../src/automations/automations.service";
import { GoalsService } from "../src/goals/goals.service";
import { SessionQueue } from "../src/queue/session.queue";
import { SessionOrchestrator } from "../src/runner/session-orchestrator";
import { TasksService } from "../src/tasks/tasks.service";
import { SessionsService } from "../src/sessions/sessions.service";
import { ObjectStorage } from "../src/files/storage";
import { createHarness, type Harness } from "./harness";

/**
 * Removing things, and the references that survive them.
 *
 * An agent holds its grants as jsonb, which the database cannot cascade
 * through. Nothing insecure follows from a stale id — `manifest.ts` resolves
 * every grant by `(id, projectId)` and a missing row resolves to nothing — but
 * an agent screen listing a repository that no longer exists tells the operator
 * something untrue about what that agent can reach.
 */
describe("deleting resources", () => {
  let harness: Harness;
  let deletion: DeletionService;
  let catalog: CatalogService;
  let agentsService: AgentsService;
  let projects: ProjectsService;
  let sessionsService: SessionsService;
  let goals: GoalsService;

  beforeAll(async () => {
    harness = await createHarness();
    deletion = harness.app.get(DeletionService);
    catalog = harness.app.get(CatalogService);
    agentsService = harness.app.get(AgentsService);
    projects = harness.app.get(ProjectsService);
    sessionsService = harness.app.get(SessionsService);
    goals = harness.app.get(GoalsService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
  });

  it("strips a deleted repo out of every agent that was granted it", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const repo = await catalog.createRepo(projectId, {
      name: "app",
      remoteUrl: "https://github.com/a/app.git",
      mountPath: "/workspace/app",
      githubInstallationId: null,
      credentialSecretId: null,
      defaultBranch: "main",
    });
    await agentsService.update(projectId, agentIds["senior-dev"]!, {
      repoAccess: [{ repoId: repo.id, mountPath: "/workspace/app", permissions: "git-write" }],
    });

    await deletion.removeRepo(projectId, repo.id);

    const after = await agentsService.get(projectId, agentIds["senior-dev"]!);
    expect(after.repoAccess).toEqual([]);
    expect(await harness.db.select().from(repos).where(eq(repos.id, repo.id))).toHaveLength(0);
  });

  it("leaves other repo grants on the same agent alone", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const make = (name: string) =>
      catalog.createRepo(projectId, {
        name,
        remoteUrl: `https://github.com/a/${name}.git`,
        mountPath: `/workspace/${name}`,
        githubInstallationId: null,
        credentialSecretId: null,
        defaultBranch: "main",
      });
    const doomed = await make("doomed");
    const kept = await make("kept");
    await agentsService.update(projectId, agentIds["senior-dev"]!, {
      repoAccess: [
        { repoId: doomed.id, mountPath: "/workspace/doomed", permissions: "git-read" },
        { repoId: kept.id, mountPath: "/workspace/kept", permissions: "git-write" },
      ],
    });

    await deletion.removeRepo(projectId, doomed.id);

    const after = await agentsService.get(projectId, agentIds["senior-dev"]!);
    expect(after.repoAccess).toEqual([
      { repoId: kept.id, mountPath: "/workspace/kept", permissions: "git-write" },
    ]);
  });

  it("strips a deleted skill out of the agents that listed it", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const skill = await catalog.createSkill(projectId, {
      name: "Plan mode",
      slug: "plan-mode",
      kind: "prompt",
      body: "plan first",
      filePath: null,
    });
    await agentsService.update(projectId, agentIds.plan!, { skillIds: [skill.id] });

    await deletion.removeSkill(projectId, skill.id);

    expect((await agentsService.get(projectId, agentIds.plan!)).skillIds).toEqual([]);
    expect(await harness.db.select().from(skills).where(eq(skills.id, skill.id))).toHaveLength(0);
  });

  it("removes a deleted agent from other agents' collaboration lists", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    // Set explicitly: the test harness seeds role agents without the
    // collaboration map, so relying on it would test the harness, not this.
    await agentsService.update(projectId, agentIds["review-coordinator"]!, {
      collaborationList: ["feasibility", "scope-guardian", "coherence", "plan-risk"],
    });

    await deletion.removeAgent(projectId, agentIds.feasibility!);

    const after = await agentsService.get(projectId, agentIds["review-coordinator"]!);
    expect(after.collaborationList).not.toContain("feasibility");
    expect(after.collaborationList).toContain("scope-guardian");
  });

  /**
   * `sessions.agent_id` is RESTRICT on purpose: a session is the record of what
   * an agent did and what it cost, and it is unattributable without the agent.
   */
  it("refuses to delete an agent that has run, with a sentence rather than a 500", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    await sessionsService.create({ projectId, agentId: agentIds.plan!, runner: "cloud" });

    await expect(deletion.removeAgent(projectId, agentIds.plan!)).rejects.toThrow(
      /session on record/,
    );
    expect(await agentsService.get(projectId, agentIds.plan!)).toBeTruthy();
  });

  it("will not delete a resource belonging to another project", async () => {
    const { projectId } = await harness.seedProject();
    const repo = await catalog.createRepo(projectId, {
      name: "app",
      remoteUrl: "https://github.com/a/app.git",
      mountPath: "/workspace/app",
      githubInstallationId: null,
      credentialSecretId: null,
      defaultBranch: "main",
    });
    const other = await projects.create({ name: "Other", slug: "other" });

    await expect(deletion.removeRepo(other.id, repo.id)).rejects.toThrow(/not found/);
  });

  /**
   * Everything cascades from `projects`, but `sessions.agent_id` is RESTRICT
   * and Postgres promises no order between two cascade paths. Without deleting
   * sessions first this fails on every project whose agents have ever run.
   */
  it("deletes a project whose sessions have all finished", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const session = await sessionsService.create({
      projectId,
      agentId: agentIds.plan!,
      runner: "cloud",
    });
    await sessionsService.setStatus(session.id, "destroyed");

    await projects.remove(projectId);

    expect(await projects.list()).toHaveLength(0);
    expect(await harness.db.select().from(agents)).toHaveLength(0);
    expect(await harness.db.select().from(sessions)).toHaveLength(0);
  });

  /**
   * The fifth review's first High: deleting the project was the way past the
   * per-session guard. A session row is the only handle on a live container,
   * and the orphan sweep skips containers whose project is gone — so the run
   * would have survived its own record, still billing and still acting.
   */
  it("refuses to delete a project while a session is still live", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const session = await sessionsService.create({
      projectId,
      agentId: agentIds.plan!,
      runner: "cloud",
    });
    await sessionsService.setStatus(session.id, "running");

    await expect(projects.remove(projectId)).rejects.toThrow(/still live/);
    expect(await projects.list()).toHaveLength(1);
  });

  it("refuses while a session is parked on an inbox question", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const session = await sessionsService.create({
      projectId,
      agentId: agentIds.plan!,
      runner: "cloud",
    });
    await sessionsService.setStatus(session.id, "waiting-inbox");

    await expect(projects.remove(projectId)).rejects.toThrow(/still live/);
  });

  /** A cascade removes the index rows; the bytes have to be removed by hand. */
  it("removes a project's stored objects, not just their rows", async () => {
    const { projectId } = await harness.seedProject();
    const files = harness.app.get(FilesService);
    await files.write(projectId, "/agents/plan/notes.md", "keep me", "text/markdown");
    expect(await files.list(projectId, "/agents/plan/")).toHaveLength(1);

    const storage = harness.app.get(ObjectStorage);
    let removedKey: string | null = null;
    const realRemove = storage.remove.bind(storage);
    storage.remove = async (key: string) => {
      removedKey = key;
      return realRemove(key);
    };

    await projects.remove(projectId);

    // The bucket key is derived from the project, so an object left behind
    // stays readable by key long after every row naming it is gone.
    expect(removedKey).toBe(`${projectId}/agents/plan/notes.md`);
    storage.remove = realRemove;
  });

  /**
   * Teardown marks a session terminal *before* destroying the runtime, so a
   * failed destroy leaves a terminal row still holding vault ids. That row is
   * the retry queue's only record of live credentials.
   */
  it("refuses to delete a session whose credential vaults are still out", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const session = await sessionsService.create({
      projectId,
      agentId: agentIds.plan!,
      runner: "cloud",
    });
    await sessionsService.setStatus(session.id, "destroyed");
    await sessionsService.recordVaults(session.id, ["vault_abc"]);

    await expect(sessionsService.remove(session.id)).rejects.toThrow(/credential vault/);
  });

  it("refuses to delete a project holding stranded credential vaults", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const session = await sessionsService.create({
      projectId,
      agentId: agentIds.plan!,
      runner: "cloud",
    });
    await sessionsService.setStatus(session.id, "failed");
    await sessionsService.recordVaults(session.id, ["vault_abc"]);

    await expect(projects.remove(projectId)).rejects.toThrow(/never confirmed released/);
  });

  /**
   * Teardown writes a terminal status *before* it destroys the container, so
   * `destroyed` on its own proves nothing about the runtime.
   */
  it("refuses a terminal session whose runtime was never confirmed destroyed", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const session = await sessionsService.create({
      projectId,
      agentId: agentIds.plan!,
      runner: "cloud",
    });
    await sessionsService.attachRuntime(session.id, "run_abc", null);
    await sessionsService.setStatus(session.id, "destroyed");

    await expect(sessionsService.remove(session.id)).rejects.toThrow(/never confirmed destroyed/);
    await expect(projects.remove(projectId)).rejects.toThrow(/never confirmed released/);
  });

  it("allows deletion once the runtime is confirmed released", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const session = await sessionsService.create({
      projectId,
      agentId: agentIds.plan!,
      runner: "cloud",
    });
    await sessionsService.attachRuntime(session.id, "run_abc", null);
    await sessionsService.setStatus(session.id, "destroyed");
    await sessionsService.markRuntimeReleased(session.id);

    await sessionsService.remove(session.id);

    expect(await harness.db.select().from(sessions)).toHaveLength(0);
  });

  /**
   * The vault retry deletes credentials and nothing else. Briefly it also
   * marked the runtime released, which would have let a container whose destroy
   * failed lose the only row pointing at it during ordinary failure recovery.
   */
  it("does not treat cleaned-up vaults as a destroyed container", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const session = await sessionsService.create({
      projectId,
      agentId: agentIds.plan!,
      runner: "cloud",
    });
    await sessionsService.attachRuntime(session.id, "run_abc", null, ["vault_1"]);
    await sessionsService.setStatus(session.id, "destroyed");

    await sessionsService.clearVaults(session.id);

    // Vaults gone, container never confirmed destroyed: still not deletable.
    await expect(sessionsService.remove(session.id)).rejects.toThrow(/never confirmed destroyed/);
  });

  it("deletes an unprovable session when the operator forces it", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const session = await sessionsService.create({
      projectId,
      agentId: agentIds.plan!,
      runner: "cloud",
    });
    await sessionsService.attachRuntime(session.id, "run_abc", null);
    await sessionsService.setStatus(session.id, "destroyed");

    await expect(sessionsService.remove(session.id)).rejects.toThrow(/never confirmed destroyed/);
    await sessionsService.remove(session.id, true);

    expect(await harness.db.select().from(sessions)).toHaveLength(0);
  });

  /**
   * The state that had no safe answer: `provision` returns a live container and
   * the row records it a statement later, so a failure in between left a
   * runtime with no handle — unattributable, unsweepable, undestroyable. The
   * handle is now written the instant it exists, and a failure to write it
   * destroys the container rather than leaking it.
   */
  it("destroys a runtime it could not record rather than leaking it", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const tasks = harness.app.get(TasksService);
    const task = await tasks.create(projectId, {
      name: "Write a spec",
      description: "",
      assigneeType: "agent",
      assigneeAgentId: agentIds.spec!,
      attachmentIds: [],
      approvalGate: false,
      scheduleKind: "now",
      runAt: null,
      cron: null,
      timezone: null,
    });

    const real = sessionsService.attachRuntime.bind(sessionsService);
    sessionsService.attachRuntime = async () => {
      throw new Error("database went away");
    };
    try {
      await harness.app.get(SessionOrchestrator).runTask(task.id);
    } finally {
      sessionsService.attachRuntime = real;
    }

    // Asserting the row, not the attempt: `FakeRunner.destroy` records the
    // call before it can fail, so "destroy was attempted" proves nothing.
    const row = await harness.db.query.sessions.findFirst();
    expect(row!.runtimeHandle).toBeNull();
    expect(harness.runner.destroyed).toContain("sesn_fake_1");
  });

  /**
   * The worst case: the runtime exists, could not be recorded, and could not be
   * destroyed either. The handle has to reach the row anyway — otherwise a
   * container is running that nothing in the system names, and the delete
   * guards have nothing to refuse on.
   */
  it("records a runtime it could neither store nor destroy", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const tasks = harness.app.get(TasksService);
    const task = await tasks.create(projectId, {
      name: "Write a spec",
      description: "",
      assigneeType: "agent",
      assigneeAgentId: agentIds.spec!,
      attachmentIds: [],
      approvalGate: false,
      scheduleKind: "now",
      runAt: null,
      cron: null,
      timezone: null,
    });

    const real = sessionsService.attachRuntime.bind(sessionsService);
    sessionsService.attachRuntime = async () => {
      throw new Error("database went away");
    };
    harness.runner.failNextDestroy(new Error("provider outage"));
    try {
      await harness.app.get(SessionOrchestrator).runTask(task.id);
    } finally {
      sessionsService.attachRuntime = real;
    }

    const row = await harness.db.query.sessions.findFirst();
    expect(row!.runtimeHandle).toBe("sesn_fake_1");
    expect(row!.runtimeReleasedAt).toBeNull();
    // And that row is therefore refused by the guard rather than deleted.
    await expect(sessionsService.remove(row!.id)).rejects.toThrow(/never confirmed destroyed/);
  });

  it("cancels an automation's schedule before deleting its row", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const automations = harness.app.get(AutomationsService);
    const queue = harness.app.get(SessionQueue);
    const cancelled: string[] = [];
    queue.cancelAutomation = async (id: string) => {
      cancelled.push(id);
    };
    const automation = await automations.create(projectId, {
      name: "weekly",
      cron: "0 9 * * 1",
      timezone: "UTC",
      agentId: agentIds.default!,
      taskName: "Summarise",
      taskBody: "do it",
      taskTemplateId: null,
      templateVariables: {},
    });

    await automations.remove(projectId, automation.id);

    // The schedule lives in Redis, not Postgres: deleting only the row leaves
    // it to fire at its next occurrence against nothing.
    expect(cancelled).toContain(automation.id);
  });

  it("refuses to delete a goal that still has a live session", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const goal = await goals.create(projectId, {
      title: "Ship it",
      spec: "do the thing",
      definitionOfDone: ["the thing is done"],
      spendCapUsd: 5,
      maxDurationMinutes: null,
      stuckThreshold: 19,
      runnerPreference: "cloud",
    });
    const session = await sessionsService.create({
      projectId,
      agentId: agentIds.plan!,
      goalId: goal.id,
      runner: "cloud",
    });
    await sessionsService.setStatus(session.id, "running");

    // Still a draft, so the status guard passes and the live-session guard is
    // the one under test.
    await expect(goals.remove(projectId, goal.id)).rejects.toThrow(/live session/);
  });

  /**
   * The orchestrator reads the goal and *then* creates the session, so a delete
   * landing between the two produces a container that spends against a goal
   * that is gone. Pausing stops the loop dispatching another iteration.
   */
  it("refuses to delete an active goal", async () => {
    const { projectId } = await harness.seedProject();
    const goal = await goals.create(projectId, {
      title: "Ship it",
      spec: "do the thing",
      definitionOfDone: ["the thing is done"],
      spendCapUsd: 5,
      maxDurationMinutes: null,
      stuckThreshold: 19,
      runnerPreference: "cloud",
    });
    await goals.approveDod(projectId, goal.id, {
      definitionOfDone: goal.definitionOfDone,
    });

    await expect(goals.remove(projectId, goal.id)).rejects.toThrow(/still active/);
  });

  it("refuses to delete a session that is still running", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const session = await sessionsService.create({
      projectId,
      agentId: agentIds.plan!,
      runner: "cloud",
    });
    await sessionsService.setStatus(session.id, "running");

    await expect(sessionsService.remove(session.id)).rejects.toThrow(/is running/);
  });

  it("deletes a finished session", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const session = await sessionsService.create({
      projectId,
      agentId: agentIds.plan!,
      runner: "cloud",
    });
    await sessionsService.setStatus(session.id, "destroyed");

    await sessionsService.remove(session.id);

    expect(await harness.db.select().from(sessions)).toHaveLength(0);
  });
});

/**
 * A fresh project is fourteen forms away from being usable without this, and
 * the roles the feature template depends on are identical in every project.
 */
describe("installing the built-ins", () => {
  let harness: Harness;
  let agentsService: AgentsService;
  let catalog: CatalogService;
  let projects: ProjectsService;

  beforeAll(async () => {
    harness = await createHarness();
    agentsService = harness.app.get(AgentsService);
    catalog = harness.app.get(CatalogService);
    projects = harness.app.get(ProjectsService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
  });

  it("puts the role agents into an empty project", async () => {
    const project = await projects.create({ name: "Todo", slug: "todo" });

    const installed = await agentsService.installBuiltIns(project.id);

    expect(installed.length).toBeGreaterThanOrEqual(14);
    const names = (await agentsService.list(project.id)).map((agent) => agent.name);
    expect(names).toContain("senior-dev");
    expect(names).toContain("review-coordinator");
    // The one spawn path in the system arrives with them.
    const coordinator = (await agentsService.list(project.id)).find(
      (agent) => agent.name === "review-coordinator",
    );
    expect(coordinator!.collaborationList).toEqual([
      "feasibility",
      "scope-guardian",
      "coherence",
      "plan-risk",
    ]);
  });

  it("is idempotent, and does not duplicate", async () => {
    const project = await projects.create({ name: "Todo", slug: "todo" });
    await agentsService.installBuiltIns(project.id);
    const first = await agentsService.list(project.id);

    await agentsService.installBuiltIns(project.id);

    expect(await agentsService.list(project.id)).toHaveLength(first.length);
  });

  /**
   * Where an agent runs is the operator's money. Re-running the installer
   * refreshes prompts we author and must never move that back.
   */
  it("keeps the operator's model and runner choices on a re-run", async () => {
    const project = await projects.create({ name: "Todo", slug: "todo" });
    await agentsService.installBuiltIns(project.id);
    const plan = (await agentsService.list(project.id)).find((agent) => agent.name === "plan")!;
    await agentsService.update(project.id, plan.id, {
      model: "claude-haiku-4-5-20251001",
      runnerPreference: "local",
    });

    await agentsService.installBuiltIns(project.id);

    const after = (await agentsService.list(project.id)).find((agent) => agent.name === "plan")!;
    expect(after.model).toBe("claude-haiku-4-5-20251001");
    expect(after.runnerPreference).toBe("local");
  });

  it("installs the built-in skills without duplicating them", async () => {
    const project = await projects.create({ name: "Todo", slug: "todo" });

    const first = await catalog.installBuiltInSkills(project.id);
    await catalog.installBuiltInSkills(project.id);

    const all = await catalog.listSkills(project.id);
    expect(all).toHaveLength(first.length);
    expect(all.map((skill) => skill.slug)).toContain("plan-mode");
    // Slugs are unique per project, which is what makes a second install safe.
    expect(new Set(all.map((skill) => skill.slug)).size).toBe(all.length);
  });

  /**
   * A collaboration list is spawn authorisation, not content. Re-installing
   * silently restored a reviewer an operator had deliberately removed.
   */
  it("does not restore a collaborator the operator removed", async () => {
    const project = await projects.create({ name: "Todo", slug: "todo" });
    await agentsService.installBuiltIns(project.id);
    const coordinator = (await agentsService.list(project.id)).find(
      (agent) => agent.name === "review-coordinator",
    )!;
    await agentsService.update(project.id, coordinator.id, {
      collaborationList: ["scope-guardian"],
    });

    await agentsService.installBuiltIns(project.id);

    const after = (await agentsService.list(project.id)).find(
      (agent) => agent.name === "review-coordinator",
    )!;
    expect(after.collaborationList).toEqual(["scope-guardian"]);
  });

  it("still refreshes the prompts it authors", async () => {
    const project = await projects.create({ name: "Todo", slug: "todo" });
    await agentsService.installBuiltIns(project.id);
    const plan = (await agentsService.list(project.id)).find((agent) => agent.name === "plan")!;
    await agentsService.update(project.id, plan.id, { rolePrompt: "scribbled over" });

    await agentsService.installBuiltIns(project.id);

    const after = (await agentsService.list(project.id)).find((agent) => agent.name === "plan")!;
    expect(after.rolePrompt).not.toBe("scribbled over");
  });

  /** "Unlikely to collide" is not a safety boundary. */
  it("leaves an operator's own skill alone when a built-in shares its slug", async () => {
    const project = await projects.create({ name: "Todo", slug: "todo" });
    await catalog.createSkill(project.id, {
      name: "My plan mode",
      slug: "plan-mode",
      kind: "prompt",
      body: "my own words",
      filePath: null,
    });

    await catalog.installBuiltInSkills(project.id);

    const mine = (await catalog.listSkills(project.id)).find(
      (skill) => skill.slug === "plan-mode",
    )!;
    expect(mine.name).toBe("My plan mode");
    expect(mine.body).toBe("my own words");
  });

  it("keeps one project's built-ins out of another", async () => {
    const a = await projects.create({ name: "A", slug: "a" });
    const b = await projects.create({ name: "B", slug: "b" });
    await agentsService.installBuiltIns(a.id);

    expect(await agentsService.list(b.id)).toHaveLength(0);
    expect(
      await harness.db.select().from(agents).where(eq(agents.projectId, a.id)),
    ).not.toHaveLength(0);
    expect(await harness.db.select({ n: sql<number>`count(*)::int` }).from(agents)).toBeTruthy();
  });
});
