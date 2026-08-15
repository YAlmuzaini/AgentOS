import { sessions as sessionsTable } from "@agentos/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { InboxService } from "../src/inbox/inbox.service";
import { SessionQueue } from "../src/queue/session.queue";
import { MaintenanceService } from "../src/runner/maintenance.service";
import { VaultCleanup } from "../src/runner/vault-cleanup";
import { OrphanSweep } from "../src/runner/orphan-sweep";
import { SessionOrchestrator } from "../src/runner/session-orchestrator";
import { SessionsService } from "../src/sessions/sessions.service";
import { SettingsService } from "../src/settings/settings.service";
import { TasksService } from "../src/tasks/tasks.service";
import { createHarness, type Harness } from "./harness";

/**
 * The two jobs that stop containers outliving their purpose.
 *
 * A parked container is deliberate — it is what makes "the agent waits for
 * you" true — so both of these are about the point where deliberate turns into
 * abandoned.
 */
describe("maintenance", () => {
  let harness: Harness;
  let maintenance: MaintenanceService;
  let vaults: VaultCleanup;
  let orchestrator: SessionOrchestrator;
  let tasks: TasksService;
  let inbox: InboxService;
  let sessions: SessionsService;
  let settings: SettingsService;
  let orphans: OrphanSweep;

  beforeAll(async () => {
    harness = await createHarness();
    maintenance = harness.app.get(MaintenanceService);
    vaults = harness.app.get(VaultCleanup);
    orchestrator = harness.app.get(SessionOrchestrator);
    tasks = harness.app.get(TasksService);
    inbox = harness.app.get(InboxService);
    sessions = harness.app.get(SessionsService);
    settings = harness.app.get(SettingsService);
    orphans = harness.app.get(OrphanSweep);

    const queue = harness.app.get(SessionQueue);
    queue.enqueueResume = async () => {};
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
  });

  /** Parks a session on a question, then backdates the park by `minutesAgo`. */
  async function parkedSession(minutesAgo: number) {
    const { projectId, agentIds } = await harness.seedProject();
    const task = await tasks.create(projectId, {
      name: "Ask something",
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

    harness.runner.setScript([
      {
        kind: "tool",
        call: {
          name: "inbox_ask",
          input: {
            question: "Which backend?",
            choices: [
              { id: "postgres", label: "Postgres" },
              { id: "sqlite", label: "SQLite" },
            ],
          },
        },
      },
    ]);
    await orchestrator.runTask(task.id);

    const [session] = await sessions.list();
    expect(session!.status).toBe("waiting-inbox");

    await harness.db
      .update(sessionsTable)
      .set({ parkedAt: new Date(Date.now() - minutesAgo * 60_000) })
      .where(eq(sessionsTable.id, session!.id));

    return { projectId, sessionId: session!.id };
  }

  it("frees a container whose question went unanswered past the timeout", async () => {
    const { projectId, sessionId } = await parkedSession(25 * 60);
    await settings.update(projectId, {
      parkedSessionTimeoutMinutes: 1440,
      orphanSweepEnabled: true,
      orphanSweepIntervalMinutes: 15,
    });

    expect(await maintenance.reapParkedSessions()).toBe(1);

    const after = await sessions.get(sessionId);
    expect(after.status).toBe("failed");
    expect(after.error).toContain("no answer within 1440 minutes");
    expect(harness.runner.destroyed).toEqual([after.runtimeHandle]);

    // The question survives its session: closed, not deleted, and still legible.
    const [message] = await inbox.list();
    expect(message!.status).toBe("closed");
    expect(message!.body).toContain("Which backend?");
    expect(message!.body).toContain("the container was freed");
  });

  it("leaves a session parked while it is still inside the timeout", async () => {
    const { projectId, sessionId } = await parkedSession(30);
    await settings.update(projectId, {
      parkedSessionTimeoutMinutes: 1440,
      orphanSweepEnabled: true,
      orphanSweepIntervalMinutes: 15,
    });

    expect(await maintenance.reapParkedSessions()).toBe(0);
    expect((await sessions.get(sessionId)).status).toBe("waiting-inbox");
    expect(harness.runner.destroyed).toEqual([]);
  });

  it("never reaps when the operator sets the timeout to 0", async () => {
    const { projectId, sessionId } = await parkedSession(60 * 24 * 30);
    await settings.update(projectId, {
      parkedSessionTimeoutMinutes: 0,
      orphanSweepEnabled: true,
      orphanSweepIntervalMinutes: 15,
    });

    expect(await maintenance.reapParkedSessions()).toBe(0);
    expect((await sessions.get(sessionId)).status).toBe("waiting-inbox");
  });

  it("archives a container AgentOS has no session for, and spares the ones it has", async () => {
    const { sessionId } = await parkedSession(5);
    const live = (await sessions.get(sessionId)).runtimeHandle!;

    harness.runner.runtimeSessions = [
      { runtimeSessionId: live, startedAt: new Date(Date.now() - 60 * 60_000) },
      { runtimeSessionId: "sesn_orphan", startedAt: new Date(Date.now() - 60 * 60_000) },
      // Young enough to still be mid-provision: never touched, whatever else
      // is true. This is the window that makes a naive sweeper dangerous.
      { runtimeSessionId: "sesn_just_started", startedAt: new Date() },
    ];

    expect(await orphans.sweep()).toBe(1);
    expect(harness.runner.destroyed).toEqual(["sesn_orphan"]);
  });

  it("does not sweep when the operator turned it off", async () => {
    const { projectId } = await parkedSession(5);
    await settings.update(projectId, {
      parkedSessionTimeoutMinutes: 1440,
      orphanSweepEnabled: false,
      orphanSweepIntervalMinutes: 15,
    });
    harness.runner.runtimeSessions = [
      { runtimeSessionId: "sesn_orphan", startedAt: new Date(Date.now() - 60 * 60_000) },
    ];

    expect(await orphans.sweep()).toBe(0);
    expect(harness.runner.destroyed).toEqual([]);
  });

  /**
   * The reaper archives the container; the vaults holding that session's
   * credentials have to go with it. Building the handle without them left a
   * live credential at the provider on every credential-bearing session it
   * ever reaped.
   */
  it("deletes the session's vaults when it reaps a parked container", async () => {
    const { projectId, sessionId } = await parkedSession(25 * 60);
    await settings.update(projectId, {
      parkedSessionTimeoutMinutes: 1440,
      orphanSweepEnabled: true,
      orphanSweepIntervalMinutes: 15,
    });
    // Stand in for a session that was provisioned with credentials.
    await harness.db
      .update(sessionsTable)
      .set({ runtimeVaultIds: ["vlt_parked"] })
      .where(eq(sessionsTable.id, sessionId));

    expect(await maintenance.reapParkedSessions()).toBe(1);
    expect(harness.runner.destroyedVaults.at(-1)).toEqual(["vlt_parked"]);
  });

  /** An answer arriving in the same moment must win over the reaper. */
  it("does not reap a session that left the park first", async () => {
    const { projectId, sessionId } = await parkedSession(25 * 60);
    await settings.update(projectId, {
      parkedSessionTimeoutMinutes: 1440,
      orphanSweepEnabled: true,
      orphanSweepIntervalMinutes: 15,
    });
    // The operator's answer lands between the reaper's read and its write.
    await sessions.setStatus(sessionId, "running");

    expect(await maintenance.reapParkedSessions()).toBe(0);
    expect((await sessions.get(sessionId)).status).toBe("running");
    expect(harness.runner.destroyed).toEqual([]);
  });

  /** A destroy that failed must not be reported as work done. */
  it("records a failed destroy on the session and does not count it as swept", async () => {
    const { projectId, sessionId } = await parkedSession(25 * 60);
    await settings.update(projectId, {
      parkedSessionTimeoutMinutes: 1440,
      orphanSweepEnabled: true,
      orphanSweepIntervalMinutes: 15,
    });
    harness.runner.failNextDestroy(new Error("provider said no"));

    await maintenance.reapParkedSessions();

    const after = await sessions.get(sessionId);
    expect(after.error).toContain("container was not destroyed");
    expect(after.error).toContain("provider said no");
  });

  /**
   * An operator's answer and the reaper can arrive together. Whichever writes
   * first wins; the loser must be told rather than silently discarded.
   */
  it("refuses an answer once the reaper has taken the session", async () => {
    const { projectId, sessionId } = await parkedSession(25 * 60);
    await settings.update(projectId, {
      parkedSessionTimeoutMinutes: 1440,
      orphanSweepEnabled: true,
      orphanSweepIntervalMinutes: 15,
    });
    expect(await maintenance.reapParkedSessions()).toBe(1);

    // The reaper closes the question on its way out, so the refusal comes from
    // the message rather than the session claim. Either way the answer cannot
    // land on a container that is gone.
    const [message] = await inbox.list();
    await expect(inbox.reply(message!.id, { selectedChoiceId: "postgres" })).rejects.toThrow(
      /already closed/,
    );
    expect((await sessions.get(sessionId)).status).toBe("failed");
  });

  /**
   * A vault outlives the container it belonged to, so one transient failure
   * during destroy would otherwise strand credentials forever.
   */
  it("retries a vault cleanup that failed during destroy", async () => {
    const { sessionId } = await parkedSession(5);
    await harness.db
      .update(sessionsTable)
      .set({ status: "destroyed", runtimeVaultIds: ["vlt_stranded"], endedAt: new Date() })
      .where(eq(sessionsTable.id, sessionId));

    expect(await vaults.drain()).toBe(1);
    // Cleared only because the delete succeeded: the row is the retry queue.
    expect((await sessions.get(sessionId)).runtimeHandle).toBeTruthy();
    const row = await harness.db.query.sessions.findFirst({
      where: eq(sessionsTable.id, sessionId),
    });
    expect(row!.runtimeVaultIds).toEqual([]);
  });

  it("reads as the defaults before the operator has saved anything", async () => {
    const { projectId } = await harness.seedProject();
    const current = await settings.get(projectId);
    expect(current.parkedSessionTimeoutMinutes).toBe(1440);
    expect(current.orphanSweepEnabled).toBe(true);
    expect(current.updatedAt).toBeNull();
  });
});
