import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AgentsService } from "../src/agents/agents.service";
import { FilesService } from "../src/files/files.service";
import { SessionOrchestrator } from "../src/runner/session-orchestrator";
import { SessionsService } from "../src/sessions/sessions.service";
import { TasksService } from "../src/tasks/tasks.service";
import { TemplatesService } from "../src/templates/templates.service";
import { createHarness, type Harness } from "./harness";

/**
 * Attachments (SPEC §4, §9.2, §10) and the commit record (SPEC §6).
 *
 * Both are the same idea from two directions: work has to outlive the
 * container that produced it. A spec file the next step cannot see, and a
 * commit nothing recorded, are each a session that may as well not have run.
 */
describe("attachments and commits", () => {
  let harness: Harness;
  let orchestrator: SessionOrchestrator;
  let tasks: TasksService;
  let files: FilesService;
  let agents: AgentsService;
  let sessions: SessionsService;
  let templates: TemplatesService;

  beforeAll(async () => {
    harness = await createHarness();
    orchestrator = harness.app.get(SessionOrchestrator);
    tasks = harness.app.get(TasksService);
    files = harness.app.get(FilesService);
    agents = harness.app.get(AgentsService);
    sessions = harness.app.get(SessionsService);
    templates = harness.app.get(TemplatesService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
  });

  function card(projectId: string, agentId: string, name = "Write a spec") {
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

  it("attaches a file the agent wrote, and refuses one it cannot read", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const task = await card(projectId, agentIds.spec!);

    // A file in another agent's home folder: readable by its owner, not by this
    // one, so attaching it must be refused for the same reason reading it is.
    await files.write(projectId, "/agents/librarian/wiki.md", "not yours");

    harness.runner.setScript([
      {
        kind: "tool",
        call: { name: "fs_write", input: { path: "/agents/spec/feature.md", content: "# Spec" } },
      },
      { kind: "tool", call: { name: "agentos_attach_file", input: { path: "/agents/spec/feature.md" } } },
      { kind: "tool", call: { name: "agentos_attach_file", input: { path: "/agents/librarian/wiki.md" } } },
    ]);

    await orchestrator.runTask(task.id);

    const after = await tasks.get(projectId, task.id);
    expect(after.attachmentIds).toHaveLength(1);
    const paths = await files.pathsByIds(projectId, after.attachmentIds);
    expect(paths).toEqual(["/agents/spec/feature.md"]);

    const results = harness.runner.injectedResults.map((entry) => entry.result);
    expect(results.at(-1)).toMatch(/refused/);
  });

  it("carries a step's attachments into the next step of a chain", async () => {
    const { projectId } = await harness.seedProject();
    await templates.installBuiltIns(projectId);
    const [template] = (await templates.list(projectId)).filter(
      (candidate) => candidate.name === "compound-engineer-workflow",
    );
    const chain = await templates.instantiate(projectId, template!.id, {
      variables: { branchName: "feat/x", feature: "onboarding" },
      titlePrefix: "",
    });

    const spec = await files.write(projectId, "/agents/spec/feature.md", "# Spec");
    const { id: fileId } = await files.idForPath(projectId, spec.path);
    await tasks.patch(projectId, chain[0]!.id, { attachmentIds: [fileId] }, "human");

    // The gate on step 0 is the operator's; closing it is what releases step 1.
    await tasks.patch(projectId, chain[0]!.id, { status: "done" }, "human");

    const plan = await tasks.get(projectId, chain[1]!.id);
    expect(plan.attachmentIds).toEqual([fileId]);
  });

  it("lets the session read an attachment its agent has no folder grant for", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const spec = await files.write(projectId, "/agents/spec/feature.md", "# The spec");
    const { id: fileId } = await files.idForPath(projectId, spec.path);

    // The plan agent has its own home folder and nothing else — the attachment
    // lives in the spec agent's home.
    const task = await card(projectId, agentIds.plan!, "Plan");
    await tasks.patch(projectId, task.id, { attachmentIds: [fileId] }, "human");

    harness.runner.setScript([
      { kind: "tool", call: { name: "fs_read", input: { path: "/agents/spec/feature.md" } } },
      { kind: "tool", call: { name: "fs_write", input: { path: "/agents/spec/sneak.md", content: "x" } } },
    ]);

    await orchestrator.runTask(task.id);

    const [read, write] = harness.runner.injectedResults.map((entry) => entry.result);
    expect(read).toBe("# The spec");
    // Read only: the grant is on the attachment, not on the folder it sits in.
    expect(write).toMatch(/refused/);
  });

  /**
   * Codex, review round eight: an attachment grant was stored as an ordinary
   * folder grant, and every folder grant is a prefix — so attaching
   * `/private/report.md` also opened `/private/report.md/anything`.
   */
  it("grants the attachment itself and nothing named beneath it", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const spec = await files.write(projectId, "/agents/spec/feature.md", "# The spec");
    const { id: fileId } = await files.idForPath(projectId, spec.path);
    // A file that would sit "under" the attachment if the grant were a prefix.
    await files.write(projectId, "/agents/spec/feature.md/secret.md", "not yours");

    const task = await card(projectId, agentIds.plan!, "Plan");
    await tasks.patch(projectId, task.id, { attachmentIds: [fileId] }, "human");

    harness.runner.setScript([
      { kind: "tool", call: { name: "fs_read", input: { path: "/agents/spec/feature.md" } } },
      {
        kind: "tool",
        call: { name: "fs_read", input: { path: "/agents/spec/feature.md/secret.md" } },
      },
    ]);
    await orchestrator.runTask(task.id);

    const [attachment, beneath] = harness.runner.injectedResults.map((entry) => entry.result);
    expect(attachment).toBe("# The spec");
    expect(beneath).toMatch(/refused/);
  });

  it("records a commit the agent reports, and refuses one it cannot have made", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const [repo] = await harness.db.execute<{ id: string }>(sql`
      INSERT INTO repos (project_id, name, remote_url, mount_path, default_branch)
      VALUES (${projectId}, 'app', 'https://example.invalid/app.git', '/workspace/app', 'main')
      RETURNING id
    `);
    await agents.update(projectId, agentIds["senior-dev"]!, {
      repoAccess: [{ repoId: repo!.id, mountPath: "/workspace/app", permissions: "git-write" }],
    });

    const task = await card(projectId, agentIds["senior-dev"]!, "Implement");
    harness.runner.setScript([
      {
        kind: "tool",
        call: {
          name: "agentos_record_commit",
          input: { repo: "app", sha: "a".repeat(40), subject: "add the thing" },
        },
      },
      { kind: "tool", call: { name: "agentos_record_commit", input: { repo: "app", sha: "nope" } } },
      {
        kind: "tool",
        call: {
          name: "agentos_record_commit",
          // A repository this agent was never granted: an attested sha against
          // somebody else's repo is a claim, not a record.
          input: { repo: "someone-elses-repo", sha: "c".repeat(40) },
        },
      },
    ]);

    await orchestrator.runTask(task.id);

    const [session] = await sessions.list();
    expect(session!.commitShas).toEqual(["a".repeat(40)]);
    const results = harness.runner.injectedResults.map((entry) => entry.result);
    expect(results[1]).toMatch(/git object id/);
    expect(results[2]).toMatch(/not a repository you hold git-write on/);

    const activity = await tasks.listActivity(task.id);
    expect(activity.map((entry) => entry.body).join("\n")).toMatch(/add the thing/);
  });

  /**
   * Codex, review round eight: `attach` was a read-modify-write, so a reviewer
   * attaching its report while the coordinator attached the consolidated one
   * lost whichever wrote first.
   */
  it("keeps both attachments when two callers attach at once", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const task = await card(projectId, agentIds.spec!);
    const first = await files.write(projectId, "/agents/spec/one.md", "1");
    const second = await files.write(projectId, "/agents/spec/two.md", "2");
    const [{ id: firstId }, { id: secondId }] = await Promise.all([
      files.idForPath(projectId, first.path),
      files.idForPath(projectId, second.path),
    ]);

    await Promise.all([tasks.attach(task.id, firstId), tasks.attach(task.id, secondId)]);

    const after = await tasks.get(projectId, task.id);
    expect([...after.attachmentIds].sort()).toEqual([firstId, secondId].sort());

    // And still a set: attaching the same file twice changes nothing.
    await Promise.all([tasks.attach(task.id, firstId), tasks.attach(task.id, firstId)]);
    expect((await tasks.get(projectId, task.id)).attachmentIds).toHaveLength(2);
  });

  /**
   * A commit that only exists in a workspace about to be deleted is not a
   * result, and the local backend cannot push. The session has to say so.
   */
  it("says on the session when a local backend's commits died with its workspace", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const task = await card(projectId, agentIds["senior-dev"]!, "Implement locally");

    // The fake backend stands in for the local worker: same contract, and the
    // control plane decides what the operator is told.
    harness.runner.collectCommitsWith("local", [
      { repo: "app", sha: "d".repeat(40), subject: "work" },
    ]);
    harness.runner.setScript([
      { kind: "tool", call: { name: "agentos_update_task", input: { status: "done" } } },
    ]);

    await orchestrator.runTask(task.id);

    const [session] = await sessions.list();
    expect(session!.commitShas).toEqual(["d".repeat(40)]);
    const warning = session!.toolCallLog.find((entry) => entry.type === "runner.warning");
    expect(warning?.summary).toMatch(/cannot push/);
  });

  it("refuses to record a commit from an agent with no git-write grant", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const task = await card(projectId, agentIds.plan!, "Plan only");

    harness.runner.setScript([
      {
        kind: "tool",
        call: { name: "agentos_record_commit", input: { repo: "app", sha: "b".repeat(40) } },
      },
    ]);

    await orchestrator.runTask(task.id);

    expect(harness.runner.injectedResults.at(0)?.result).toMatch(/no git-write grant/);
    const [session] = await sessions.list();
    expect(session!.commitShas).toEqual([]);
  });
});
