import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { InboxService } from "../src/inbox/inbox.service";
import { SessionQueue } from "../src/queue/session.queue";
import { SessionOrchestrator } from "../src/runner/session-orchestrator";
import { SessionsService } from "../src/sessions/sessions.service";
import { TasksService } from "../src/tasks/tasks.service";
import { createHarness, type Harness } from "./harness";

/**
 * SPEC §22.7 (inbox resume) and §22.8 (multiple choice).
 *
 * This is the mechanism the whole "walk away" promise rests on: an agent that
 * needs a decision parks, its container survives, and the operator's answer is
 * what starts it again.
 */
describe("inbox pause and resume", () => {
  let harness: Harness;
  let orchestrator: SessionOrchestrator;
  let tasks: TasksService;
  let inbox: InboxService;
  let sessions: SessionsService;
  let resumes: Array<{ sessionId: string; inboxMessageId: string }>;

  beforeAll(async () => {
    harness = await createHarness();
    orchestrator = harness.app.get(SessionOrchestrator);
    tasks = harness.app.get(TasksService);
    inbox = harness.app.get(InboxService);
    sessions = harness.app.get(SessionsService);

    // Resume is queued; drive it explicitly so the test is deterministic.
    const queue = harness.app.get(SessionQueue);
    queue.enqueueResume = async (sessionId: string, inboxMessageId: string) => {
      resumes.push({ sessionId, inboxMessageId });
    };
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    resumes = [];
  });

  async function runUntilParked() {
    const { projectId, agentIds } = await harness.seedProject();
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

    harness.runner.setScript([
      {
        kind: "tool",
        call: {
          name: "inbox_ask",
          input: {
            question: "Which storage backend should the spec assume?",
            choices: [
              { id: "postgres", label: "Postgres" },
              { id: "sqlite", label: "SQLite" },
            ],
          },
        },
      },
      // Anything after the park must not run until the operator answers.
      { kind: "tool", call: { name: "agentos_update_task", input: { status: "done" } } },
    ]);

    await orchestrator.runTask(task.id);
    return { projectId, task };
  }

  it("parks the session and keeps the container alive", async () => {
    const { projectId, task } = await runUntilParked();

    const [session] = await sessions.list();
    expect(session!.status).toBe("waiting-inbox");
    // The container is deliberately NOT destroyed: the operator may take hours.
    expect(harness.runner.destroyed).toHaveLength(0);

    // The queued work after the question did not run.
    const parkedTask = await tasks.get(projectId, task.id);
    expect(parkedTask.status).toBe("doing");

    const messages = await inbox.list("open");
    expect(messages).toHaveLength(1);
    expect(messages[0]!.kind).toBe("multiple-choice");
    expect(messages[0]!.choices.map((choice) => choice.id)).toEqual(["postgres", "sqlite"]);
    expect(messages[0]!.sessionId).toBe(session!.id);
  });

  it("resumes the session with the chosen answer and then finishes it", async () => {
    const { projectId, task } = await runUntilParked();
    const [message] = await inbox.list("open");

    const answered = await inbox.reply(message!.id, { selectedChoiceId: "sqlite" });
    expect(answered.status).toBe("answered");
    expect(answered.selectedChoiceId).toBe("sqlite");
    expect(resumes).toHaveLength(1);

    // What the runner hands back to the parked tool call is the chosen label.
    harness.runner.setScript([
      { kind: "tool", call: { name: "agentos_update_task", input: { status: "done" } } },
    ]);
    await orchestrator.resumeSession(resumes[0]!.sessionId, resumes[0]!.inboxMessageId);

    const injected = harness.runner.injectedResults;
    expect(injected[0]!.result).toBe("SQLite");

    const [session] = await sessions.list();
    expect(session!.status).toBe("destroyed");
    expect(harness.runner.destroyed).toHaveLength(1);
    expect((await tasks.get(projectId, task.id)).status).toBe("done");
  });

  it("accepts a free-text answer to a plain message", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const task = await tasks.create(projectId, {
      name: "Ask something",
      description: "",
      assigneeType: "agent",
      assigneeAgentId: agentIds.default!,
      attachmentIds: [],
      approvalGate: false,
      scheduleKind: "now",
      runAt: null,
      cron: null,
      timezone: null,
    });

    // inbox_send does not park — it is a one-way note.
    harness.runner.setScript([
      { kind: "tool", call: { name: "inbox_send", input: { body: "heads up, this is slow" } } },
    ]);
    await orchestrator.runTask(task.id);

    const [message] = await inbox.list("open");
    expect(message!.kind).toBe("text");
    const [session] = await sessions.list();
    expect(session!.status).toBe("destroyed");

    const answered = await inbox.reply(message!.id, { body: "noted, carry on" });
    expect(answered.status).toBe("answered");
  });

  it("refuses an answer that is not one of the offered choices", async () => {
    await runUntilParked();
    const [message] = await inbox.list("open");
    await expect(inbox.reply(message!.id, { selectedChoiceId: "mongodb" })).rejects.toThrow(
      /not one of the offered choices/,
    );
  });

  it("refuses to answer the same question twice", async () => {
    await runUntilParked();
    const [message] = await inbox.list("open");
    await inbox.reply(message!.id, { selectedChoiceId: "postgres" });
    await expect(inbox.reply(message!.id, { selectedChoiceId: "sqlite" })).rejects.toThrow(
      /already answered/,
    );
  });

  it("refuses inbox tools for an agent without inbox access", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const { AgentsService } = await import("../src/agents/agents.service");
    await harness.app.get(AgentsService).update(projectId, agentIds.default!, {
      inboxAccess: false,
    });

    const task = await tasks.create(projectId, {
      name: "No inbox",
      description: "",
      assigneeType: "agent",
      assigneeAgentId: agentIds.default!,
      attachmentIds: [],
      approvalGate: false,
      scheduleKind: "now",
      runAt: null,
      cron: null,
      timezone: null,
    });

    harness.runner.setScript([
      { kind: "tool", call: { name: "inbox_send", input: { body: "let me in" } } },
    ]);
    await orchestrator.runTask(task.id);

    expect(harness.runner.injectedResults[0]!.result).toMatch(/no inbox access/);
    expect(await inbox.list("open")).toHaveLength(0);
  });
});
