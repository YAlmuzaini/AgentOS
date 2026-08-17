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
   * The local backend pushes before its workspace is deleted, and the session
   * records where the work ended up. This used to be the opposite test — the
   * commits died with the directory and the row said so — which made local
   * `git-write` sessions produce shas and nothing a human could reach.
   */
  it("records the remote the local backend pushed a session's commits to", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const task = await card(projectId, agentIds["senior-dev"]!, "Implement locally");

    harness.runner.collectCommitsWith("local", [
      { repo: "app", sha: "d".repeat(40), subject: "work" },
    ]);
    harness.runner.publishWith({
      records: [
        {
          repo: "app",
          branch: "feat/x",
          pushed: true,
          remoteSha: "d".repeat(40),
          commits: 1,
          error: null,
        },
      ],
      retainedWorkspace: null,
    });
    harness.runner.setScript([
      { kind: "tool", call: { name: "agentos_update_task", input: { status: "done" } } },
    ]);

    await orchestrator.runTask(task.id);

    const [session] = await sessions.list();
    expect(session!.commitShas).toEqual(["d".repeat(40)]);
    expect(session!.publish?.records[0]).toMatchObject({
      repo: "app",
      branch: "feat/x",
      pushed: true,
      remoteSha: "d".repeat(40),
    });
    // Nothing to warn about when the work reached the remote.
    expect(session!.toolCallLog.find((entry) => entry.type === "runner.warning")).toBeUndefined();
  });

  /**
   * The failure that must never be silent: the push did not land, so the only
   * copy of the work is a directory on the worker. The row has to name it.
   */
  it("says where the workspace was kept when a push failed", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const task = await card(projectId, agentIds["senior-dev"]!, "Implement locally");

    harness.runner.collectCommitsWith("local", [
      { repo: "app", sha: "e".repeat(40), subject: "work" },
    ]);
    harness.runner.publishWith({
      records: [
        {
          repo: "app",
          branch: "feat/x",
          pushed: false,
          remoteSha: null,
          commits: 2,
          error: "non-fast-forward",
        },
      ],
      retainedWorkspace: "/var/agentos/quarantine-lsesn_1",
    });
    harness.runner.setScript([
      { kind: "tool", call: { name: "agentos_update_task", input: { status: "done" } } },
    ]);

    await orchestrator.runTask(task.id);

    const [session] = await sessions.list();
    expect(session!.publish?.retainedWorkspace).toBe("/var/agentos/quarantine-lsesn_1");
    const warning = session!.toolCallLog.find((entry) => entry.type === "runner.warning");
    expect(warning?.summary).toMatch(/could not push/);
    expect(warning?.summary).toMatch(/quarantine-lsesn_1/);
  });

  /**
   * Codex review, blocker 2: a `/publish` call that never reached the worker
   * used to be swallowed, and teardown destroyed the workspace anyway — so a
   * momentary network blip between two calls to the same worker deleted the
   * only copy of the work. Not being able to ask is precisely when destroying
   * is unsafe.
   */
  it("does not destroy the workspace when the push could not even be attempted", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const task = await card(projectId, agentIds["senior-dev"]!, "Implement locally");

    harness.runner.collectCommitsWith("local", [
      { repo: "app", sha: "f".repeat(40), subject: "work" },
    ]);
    harness.runner.failNextPublish(new Error("connect ECONNREFUSED"));
    harness.runner.setScript([
      { kind: "tool", call: { name: "agentos_update_task", input: { status: "done" } } },
    ]);

    await orchestrator.runTask(task.id);

    const [session] = await sessions.list();
    // The container was deliberately left alone…
    expect(harness.runner.destroyed).toHaveLength(0);
    // …and the row says so, in a sentence an operator can act on.
    expect(session!.error ?? "").toMatch(/could not be confirmed as pushed/);
  });

  /**
   * Codex round nine: the cloud runtime's events are provider-controlled and
   * arrive verbatim. An MCP server that was handed a bearer token can echo it
   * in an error or a tool name, and the control plane was persisting that
   * straight into the tool-call log and the session's failure text.
   */
  it("scrubs a resolved secret out of anything a runner says", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const task = await card(projectId, agentIds["senior-dev"]!, "Leaky run");

    const { registerSecret } = await import("../src/observability/secret-registry");
    registerSecret("ghp_a_very_real_looking_token_value");

    harness.runner.setScript([
      {
        kind: "log",
        type: "agent.message",
        name: "mcp__github__ghp_a_very_real_looking_token_value",
        summary: "the server said: Authorization ghp_a_very_real_looking_token_value",
      },
    ]);

    await orchestrator.runTask(task.id);

    const [session] = await sessions.list();
    const full = await sessions.get(session!.id);
    const said = JSON.stringify(full.toolCallLog);
    expect(said).not.toContain("ghp_a_very_real_looking_token_value");
    expect(said).toContain("<redacted-secret>");
  });

  /**
   * Codex round ten: a tool call's *arguments* are written into task activity,
   * goal progress and inbox rows by the handlers themselves — none of which
   * pass through the log, so scrubbing there left these untouched.
   */
  it("scrubs a secret out of tool-call arguments before a handler stores them", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const task = await card(projectId, agentIds["senior-dev"]!, "Chatty run");

    const { registerSecret } = await import("../src/observability/secret-registry");
    registerSecret("ghp_another_real_looking_token");

    harness.runner.setScript([
      {
        kind: "tool",
        call: {
          name: "agentos_add_activity",
          input: { note: "used ghp_another_real_looking_token to reach the API" },
        },
      },
    ]);

    await orchestrator.runTask(task.id);

    const activity = await tasks.listActivity(task.id);
    const said = JSON.stringify(activity);
    expect(said).not.toContain("ghp_another_real_looking_token");
    expect(said).toContain("<redacted-secret>");
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
