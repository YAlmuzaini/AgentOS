import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LocalVmRunner } from "../src/runner/local-runner";
import { SessionOrchestrator } from "../src/runner/session-orchestrator";
import { SessionsService } from "../src/sessions/sessions.service";
import { SettingsService } from "../src/settings/settings.service";
import { TasksService } from "../src/tasks/tasks.service";
import { createHarness, type Harness } from "./harness";
import { stubQueue } from "./queue-stub";

/**
 * What happens when the operator pinned `local` and the worker says no.
 *
 * The worker refuses any session whose agent needs a restricted network,
 * because it cannot enforce egress — and seeded agents have no environment at
 * all, which resolves to deny-everything. So this is not an edge case: it is
 * what the first task an operator runs after flipping the switch does.
 */
describe("pinned to local", () => {
  let harness: Harness;
  let orchestrator: SessionOrchestrator;
  let sessions: SessionsService;
  let settings: SettingsService;
  let tasks: TasksService;

  beforeAll(async () => {
    harness = await createHarness({
      // Healthy, and refuses — exactly what a real worker does for a session
      // whose network it cannot enforce.
      override: (builder) =>
        builder.overrideProvider(LocalVmRunner).useValue({
          name: "local",
          configured: true,
          healthy: async () => true,
          status: async () => ({ configured: true, healthy: true, ready: true, url: "https://worker.test", activeSessions: 0, capacity: 1, draining: false, workerId: "test", version: "test", location: "personal-vps", capabilities: ["publish"] }),
          provision: async () => {
            throw new Error(
              "local runner /sessions: 409 this session requires a limited network",
            );
          },
        }),
    });
    orchestrator = harness.app.get(SessionOrchestrator);
    sessions = harness.app.get(SessionsService);
    settings = harness.app.get(SettingsService);
    tasks = harness.app.get(TasksService);
    stubQueue(harness);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
  });

  async function runOneTask(projectId: string, agentId: string): Promise<void> {
    const task = await tasks.create(projectId, {
      name: "Pinned",
      description: "",
      assigneeType: "agent",
      assigneeAgentId: agentId,
      attachmentIds: [],
      approvalGate: false,
      scheduleKind: "now",
      runAt: null,
      cron: null,
      timezone: null,
    } as never);
    await orchestrator.runTask(task.id);
  }

  /**
   * The operator moved off cloud to stop paying per token. Running there anyway
   * spends the money they moved away from — and once that credential is
   * exhausted it surfaces as a bare 401 that says nothing about the refusal
   * that actually caused it.
   */
  it("fails with the refusal rather than billing cloud", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    await settings.update(projectId, {
      parkedSessionTimeoutMinutes: 1440,
      orphanSweepEnabled: false,
      orphanSweepIntervalMinutes: 15,
      defaultRunner: "local",
    });

    await runOneTask(projectId, agentIds.spec!);

    const [session] = await sessions.list();
    expect(session!.status).toBe("failed");
    expect(session!.error).toContain("set to run locally");
    // The reason the worker gave is carried through, because it is the only
    // thing here that tells the operator what to change.
    expect(session!.error).toContain("limited network");
    expect(harness.runner.provisioned).toHaveLength(0);
  });

  /** `auto` means "prefer local, fall back" — that behaviour is unchanged. */
  it("still falls back to cloud on auto", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    await settings.update(projectId, {
      parkedSessionTimeoutMinutes: 1440,
      orphanSweepEnabled: false,
      orphanSweepIntervalMinutes: 15,
      defaultRunner: "auto",
    });

    harness.runner.setScript([]);
    await runOneTask(projectId, agentIds.spec!);

    const [session] = await sessions.list();
    expect(session!.runner).toBe("cloud");
    expect(harness.runner.provisioned).toHaveLength(1);
  });
});
