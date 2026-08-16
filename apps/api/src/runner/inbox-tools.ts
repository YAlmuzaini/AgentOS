import type { InboxChoice, InboxQuestion } from "@agentos/shared";
import { Injectable } from "@nestjs/common";
import { renderAnswers, summariseQuestions } from "../inbox/inbox-answers";
import { InboxService } from "../inbox/inbox.service";
import type { RunnerToolCall } from "./runner.types";
import { deny, type ToolContext, type ToolOutcome } from "./tool-types";

/**
 * The Inbox MCP of SPEC §12 and §20: `inbox.send`, `inbox.ask`, `inbox.read`.
 *
 * Split from the other tools because this is the one channel that reaches a
 * human, and because `ask` is the only tool call that does not return — it
 * parks the session until the operator answers.
 */
@Injectable()
export class InboxToolHandler {
  constructor(private readonly inbox: InboxService) {}

  async send(ctx: ToolContext, input: Record<string, unknown>): Promise<ToolOutcome> {
    if (!ctx.inboxAccess) {
      return deny("this agent has no inbox access");
    }
    const body = typeof input.body === "string" ? input.body.trim() : "";
    if (!body) {
      return deny("body is empty");
    }
    await this.inbox.createFromAgent({
      projectId: ctx.projectId,
      agentId: ctx.agentId,
      sessionId: ctx.sessionId,
      taskId: ctx.taskId,
      goalId: ctx.goalId,
      kind: "text",
      body,
      runtimeToolUseId: null,
    });
    return { kind: "result", text: "message delivered to the operator inbox" };
  }

  /**
   * The thread so far, so an agent can read an answer instead of re-asking.
   *
   * Scoped to this session's task or goal — never the whole inbox, which would
   * hand one agent every other agent's conversation with the operator.
   */
  async read(ctx: ToolContext): Promise<ToolOutcome> {
    if (!ctx.inboxAccess) {
      return deny("this agent has no inbox access");
    }
    const thread = await this.inbox.thread({
      projectId: ctx.projectId,
      taskId: ctx.taskId,
      goalId: ctx.goalId,
    });
    if (thread.length === 0) {
      return { kind: "result", text: "(this thread is empty — nothing has been asked yet)" };
    }
    const rendered = thread.map((message) => {
      // A message that asked several things reads as the pairs it was asked
      // and answered in; one that asked once keeps the older single line.
      const answered =
        message.questions.length > 0 && message.answers.length > 0
          ? `\n${renderAnswers(message.questions, message.answers)}`
          : message.selectedChoiceId
            ? ` — answered: ${
                message.choices.find((choice) => choice.id === message.selectedChoiceId)?.label ??
                message.selectedChoiceId
              }`
            : "";
      return `[${message.createdAt}] ${message.from}, ${message.status}${answered}\n${message.body}`;
    });
    return { kind: "result", text: rendered.join("\n\n") };
  }

  /**
   * Parks the session: no tool result is sent until the operator answers.
   *
   * One park can carry several questions. The operator is not at their desk —
   * that is the premise of the whole product — so an agent that needs three
   * decisions asks for three, rather than holding a container open three times
   * and waiting out three round trips.
   */
  async ask(ctx: ToolContext, call: RunnerToolCall): Promise<ToolOutcome> {
    if (!ctx.inboxAccess) {
      return deny("this agent has no inbox access");
    }
    const questions = normaliseQuestions(call.input);
    if (questions.length === 0) {
      return deny(
        "ask needs at least one question, each with a non-empty question and 2-4 choices",
      );
    }

    const message = await this.inbox.createFromAgent({
      projectId: ctx.projectId,
      agentId: ctx.agentId,
      sessionId: ctx.sessionId,
      taskId: ctx.taskId,
      goalId: ctx.goalId,
      kind: "multiple-choice",
      body: summariseQuestions(questions),
      // The first question's choices also land in the legacy column, so a
      // single-question ask still renders anywhere that reads `choices`.
      choices: questions.length === 1 ? questions[0]!.choices : [],
      questions,
      runtimeToolUseId: call.toolUseId,
    });

    return { kind: "park", inboxMessageId: message.id, text: null };
  }
}

/**
 * Reads either shape of `inbox_ask`: a list of questions, or the single
 * `question` + `choices` an older prompt may still produce.
 *
 * Ids are assigned here rather than asked of the model — an answer has to be
 * matched back to its question, and a model that repeats an id or omits one
 * would leave the operator answering a question nobody asked.
 */
function normaliseQuestions(input: Record<string, unknown>): InboxQuestion[] {
  const raw = Array.isArray(input.questions)
    ? input.questions
    : input.question !== undefined
      ? [{ question: input.question, choices: input.choices }]
      : [];

  return raw.flatMap((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      return [];
    }
    const candidate = entry as {
      question?: unknown;
      detail?: unknown;
      choices?: unknown;
      allowFreeText?: unknown;
    };
    const question = typeof candidate.question === "string" ? candidate.question.trim() : "";
    const choices = normaliseChoices(candidate.choices);
    if (!question || choices.length < 2) {
      return [];
    }
    return [
      {
        id: `q${index + 1}`,
        question,
        detail: typeof candidate.detail === "string" ? candidate.detail.trim() : "",
        choices,
        allowFreeText: candidate.allowFreeText === true,
      },
    ];
  });
}

function normaliseChoices(raw: unknown): InboxChoice[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) {
      return [];
    }
    const candidate = entry as { id?: unknown; label?: unknown };
    if (typeof candidate.id !== "string" || typeof candidate.label !== "string") {
      return [];
    }
    return [{ id: candidate.id, label: candidate.label }];
  });
}
