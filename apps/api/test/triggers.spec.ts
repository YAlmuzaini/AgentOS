import { sanitizeWebhookPayload } from "@agentos/shared";
import { UnauthorizedException } from "@nestjs/common";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AutomationsService } from "../src/automations/automations.service";
import { SessionQueue } from "../src/queue/session.queue";
import { TasksService } from "../src/tasks/tasks.service";
import { TemplatesService } from "../src/templates/templates.service";
import { TriggersService } from "../src/triggers/triggers.service";
import { sign } from "../src/triggers/webhook-signature";
import { createHarness, type Harness } from "./harness";
import { stubQueue, type QueueSink } from "./queue-stub";

/** Phase 5 done-when (SPEC §21) and acceptance test §22.11. */
describe("triggers and automations", () => {
  let harness: Harness;
  let triggers: TriggersService;
  let automations: AutomationsService;
  let templates: TemplatesService;
  let tasks: TasksService;
  let queued: QueueSink;

  beforeAll(async () => {
    harness = await createHarness();
    triggers = harness.app.get(TriggersService);
    automations = harness.app.get(AutomationsService);
    templates = harness.app.get(TemplatesService);
    tasks = harness.app.get(TasksService);

    queued = stubQueue(harness);
    const queue = harness.app.get(SessionQueue);
    // Schedules are asserted through the service, not by waiting on a clock.
    queue.scheduleAutomation = async () => {};
    queue.cancelAutomation = async () => {};
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    queued.clear();
  });

  async function makeTrigger(projectId: string, agentId: string) {
    return triggers.create(projectId, {
      name: "support-inbound",
      agentId,
      jobPrompt: "Analyse this support conversation and assign the right human.",
      enabled: true,
    });
  }

  it("rejects a delivery with a bad signature and records the attempt", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const trigger = await makeTrigger(projectId, agentIds.default!);
    const body = JSON.stringify({ conversation: "my invoice is wrong" });

    await expect(
      triggers.handleDelivery({
        triggerId: trigger.id,
        rawBody: body,
        signature: "sha256=deadbeef",
        timestamp: String(Date.now()),
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const fires = await triggers.fires(projectId, trigger.id);
    expect(fires).toHaveLength(1);
    expect(fires[0]!.accepted).toBe(false);
    expect(queued.runs).toEqual([]);
  });

  it("rejects a replayed delivery even with a valid signature", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const trigger = await makeTrigger(projectId, agentIds.default!);
    const body = "{}";
    const stale = Date.now() - 10 * 60_000;

    await expect(
      triggers.handleDelivery({
        triggerId: trigger.id,
        rawBody: body,
        signature: sign(trigger.signingKey, stale, body),
        timestamp: String(stale),
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("creates one scoped task for a signed delivery", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const trigger = await makeTrigger(projectId, agentIds.default!);
    const timestamp = Date.now();
    const body = JSON.stringify({
      conversation: "my invoice is wrong",
      api_key: "sk-should-not-reach-the-agent",
    });

    const result = await triggers.handleDelivery({
      triggerId: trigger.id,
      rawBody: body,
      signature: sign(trigger.signingKey, timestamp, body),
      timestamp: String(timestamp),
    });

    const task = await tasks.get(projectId, result.taskId);
    expect(task.assigneeAgentId).toBe(agentIds.default);
    expect(task.description).toContain("Analyse this support conversation");
    expect(task.description).toContain("my invoice is wrong");
    // The payload is sanitised before it reaches a prompt.
    expect(task.description).not.toContain("sk-should-not-reach-the-agent");
    expect(task.description).toContain("[redacted]");
    expect(queued.runs).toEqual([task.id]);

    const fires = await triggers.fires(projectId, trigger.id);
    expect(fires[0]!.accepted).toBe(true);
  });

  /**
   * A valid signature stays valid until its timestamp ages out, so without a
   * spent-delivery record the same captured POST spawns a container every time
   * it is re-sent inside the window.
   */
  it("accepts a signed delivery exactly once", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const trigger = await makeTrigger(projectId, agentIds.default!);
    const timestamp = Date.now();
    const body = JSON.stringify({ conversation: "duplicate me" });
    const signature = sign(trigger.signingKey, timestamp, body);

    const first = await triggers.handleDelivery({
      triggerId: trigger.id,
      rawBody: body,
      signature,
      timestamp: String(timestamp),
    });
    expect(queued.runs).toEqual([first.taskId]);

    await expect(
      triggers.handleDelivery({
        triggerId: trigger.id,
        rawBody: body,
        // Re-spelled with the prefix: the same digest must not buy a second run.
        signature: `sha256=${signature.toUpperCase()}`,
        timestamp: String(timestamp),
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(queued.runs).toEqual([first.taskId]);
    expect(await tasks.list(projectId)).toHaveLength(1);
  });

  it("invalidates the old key when the secret is rotated", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const trigger = await makeTrigger(projectId, agentIds.default!);
    const rotated = await triggers.rotateSecret(projectId, trigger.id);
    expect(rotated.signingKey).not.toBe(trigger.signingKey);

    const timestamp = Date.now();
    const body = "{}";
    await expect(
      triggers.handleDelivery({
        triggerId: trigger.id,
        rawBody: body,
        signature: sign(trigger.signingKey, timestamp, body),
        timestamp: String(timestamp),
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    await expect(
      triggers.handleDelivery({
        triggerId: trigger.id,
        rawBody: body,
        signature: sign(rotated.signingKey, timestamp, body),
        timestamp: String(timestamp),
      }),
    ).resolves.toBeTruthy();
  });

  it("fires an inline automation into one task", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const automation = await automations.create(projectId, {
      name: "weekly-linkedin",
      cron: "0 9 * * 1",
      timezone: "Europe/Amsterdam",
      agentId: agentIds.default!,
      taskTemplateId: null,
      taskName: "Write this week's LinkedIn post",
      taskBody: "Draft it, then inbox me before posting.",
      templateVariables: {},
      enabled: true,
    });

    const { taskIds } = await automations.fire(automation.id);
    expect(taskIds).toHaveLength(1);
    expect(queued.runs).toEqual(taskIds);

    const task = await tasks.get(projectId, taskIds[0]!);
    expect(task.name).toBe("Write this week's LinkedIn post");

    const [after] = await automations.list(projectId);
    expect(after!.lastFiredAt).not.toBeNull();
  });

  it("fires a template automation into a whole chain, releasing only step 0", async () => {
    const { projectId } = await harness.seedProject();
    const [template] = await templates.installBuiltIns(projectId);
    const automation = await automations.create(projectId, {
      name: "monthly-feature",
      cron: "0 9 1 * *",
      timezone: "UTC",
      agentId: null,
      taskTemplateId: template!.id,
      taskName: "",
      taskBody: "",
      templateVariables: { branchName: "feat/monthly", feature: "the monthly feature" },
      enabled: true,
    });

    const { taskIds } = await automations.fire(automation.id);
    expect(taskIds).toHaveLength(9);
    expect(queued.runs).toEqual([taskIds[0]]);
  });

  it("does not fire while disabled", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const automation = await automations.create(projectId, {
      name: "paused",
      cron: "* * * * *",
      timezone: "UTC",
      agentId: agentIds.default!,
      taskTemplateId: null,
      taskName: "x",
      taskBody: "",
      templateVariables: {},
      enabled: true,
    });
    await automations.setEnabled(projectId, automation.id, false);

    const { taskIds } = await automations.fire(automation.id);
    expect(taskIds).toEqual([]);
    expect(queued.runs).toEqual([]);
  });

  it("installs the two example triggers once, skipping roles the project lacks", async () => {
    const { projectId } = await harness.seedProject();

    const installed = await triggers.installExamples(projectId);
    expect(installed.map((trigger) => trigger.name).sort()).toEqual([
      "bug-report",
      "support-inbound",
    ]);
    // The key is minted here and shown here; it is never returned again.
    expect(installed.every((trigger) => trigger.signingKey.length > 0)).toBe(true);
    expect((await triggers.list(projectId)).map((trigger) => trigger.name).sort()).toEqual([
      "bug-report",
      "support-inbound",
    ]);

    // Re-installing is a no-op rather than a second pair of triggers.
    expect(await triggers.installExamples(projectId)).toEqual([]);
    expect(await triggers.list(projectId)).toHaveLength(2);
  });

  it("strips credentials and bounds size when sanitising a payload", () => {
    const text = sanitizeWebhookPayload({
      Authorization: "Bearer secret",
      nested: { apiKey: "k", fine: "keep me" },
      big: "x".repeat(5000),
    });
    expect(text).not.toContain("Bearer secret");
    expect(text).toContain("keep me");
    expect(text).toContain("[redacted]");
    expect(text.length).toBeLessThan(9000);
  });
});
