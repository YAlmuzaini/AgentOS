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

    const messages = await inbox.list(undefined, "open");
    expect(messages).toHaveLength(1);
    expect(messages[0]!.kind).toBe("multiple-choice");
    expect(messages[0]!.choices.map((choice) => choice.id)).toEqual(["postgres", "sqlite"]);
    expect(messages[0]!.sessionId).toBe(session!.id);
  });

  it("resumes the session with the chosen answer and then finishes it", async () => {
    const { projectId, task } = await runUntilParked();
    const [message] = await inbox.list(undefined, "open");

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

    const [message] = await inbox.list(undefined, "open");
    expect(message!.kind).toBe("text");
    const [session] = await sessions.list();
    expect(session!.status).toBe("destroyed");

    const answered = await inbox.reply(message!.id, { body: "noted, carry on" });
    expect(answered.status).toBe("answered");
  });

  it("refuses an answer that is not one of the offered choices", async () => {
    await runUntilParked();
    const [message] = await inbox.list(undefined, "open");
    await expect(inbox.reply(message!.id, { selectedChoiceId: "mongodb" })).rejects.toThrow(
      /not one of the offered choices/,
    );
  });

  it("refuses to answer the same question twice", async () => {
    await runUntilParked();
    const [message] = await inbox.list(undefined, "open");
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
    expect(await inbox.list(undefined, "open")).toHaveLength(0);
  });

  /**
   * An agent that needs three decisions asks once. Parking three times holds a
   * container open across three round trips through a human who is not there.
   */
  it("asks several questions in one park and resumes with every answer", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const task = await tasks.create(projectId, {
      name: "Ship onboarding",
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
            questions: [
              {
                question: "Which auth mechanism?",
                detail: "It decides the whole flow.",
                choices: [
                  { id: "magic", label: "Magic link" },
                  { id: "password", label: "Email and password" },
                ],
              },
              {
                question: "Seed the first operator account?",
                choices: [
                  { id: "yes", label: "Yes, seed it" },
                  { id: "no", label: "No, self-registration" },
                ],
                allowFreeText: true,
              },
            ],
          },
        },
      },
    ]);

    await orchestrator.runTask(task.id);

    const [message] = await inbox.list(undefined, "open");
    expect(message!.questions).toHaveLength(2);
    expect(message!.questions[0]!.detail).toBe("It decides the whole flow.");
    // Everything the operator needs to answer without opening another screen.
    expect(message!.agentName).toBe("spec");
    expect(message!.subject).toMatchObject({ kind: "task", name: "Ship onboarding" });

    // Half an answer is refused: an agent told two of three proceeds on a guess.
    await expect(
      inbox.reply(message!.id, { answers: [{ questionId: "q1", choiceId: "magic" }] }),
    ).rejects.toThrow(/was not answered/);
    await expect(
      inbox.reply(message!.id, {
        answers: [
          { questionId: "q1", choiceId: "not-offered" },
          { questionId: "q2", choiceId: "yes" },
        ],
      }),
    ).rejects.toThrow(/not one of the offered choices/);

    harness.runner.setScript([
      { kind: "tool", call: { name: "agentos_update_task", input: { status: "done" } } },
    ]);
    await inbox.reply(message!.id, {
      answers: [
        { questionId: "q1", choiceId: "magic" },
        { questionId: "q2", choiceId: "no", text: "they invite each other" },
      ],
    });
    await orchestrator.resumeSession(resumes[0]!.sessionId, resumes[0]!.inboxMessageId);

    // The agent reads its own questions back with the answers attached.
    const resumed = harness.runner.injectedResults.at(0)?.result ?? "";
    expect(resumed).toContain("Q: Which auth mechanism?");
    expect(resumed).toContain("A: Magic link");
    expect(resumed).toContain("they invite each other");

    const [answered] = await inbox.list(undefined, "answered");
    expect(answered!.answers).toHaveLength(2);
    expect(answered!.answeredAt).not.toBeNull();
  });

  it("still accepts a single-question ask and a single-choice answer", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    const task = await tasks.create(projectId, {
      name: "One decision",
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
            question: "Ship it?",
            choices: [
              { id: "yes", label: "Ship" },
              { id: "no", label: "Hold" },
            ],
          },
        },
      },
    ]);
    await orchestrator.runTask(task.id);

    const [message] = await inbox.list(undefined, "open");
    // The legacy column is still filled, so anything reading `choices` works.
    expect(message!.choices).toHaveLength(2);
    expect(message!.questions).toHaveLength(1);

    harness.runner.setScript([]);
    await inbox.reply(message!.id, { selectedChoiceId: "yes" });
    await orchestrator.resumeSession(resumes[0]!.sessionId, resumes[0]!.inboxMessageId);
    // One question still answers with the label alone, not a Q/A pair.
    expect(harness.runner.injectedResults.at(0)?.result).toBe("Ship");
  });
});
