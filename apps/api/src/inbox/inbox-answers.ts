import type { InboxAnswer, InboxQuestion, ReplyInboxInput } from "@agentos/shared";
import { BadRequestException } from "@nestjs/common";
import type { InboxRow } from "./inbox-dto";

/**
 * Turning an operator's reply into the answer the parked agent reads.
 *
 * A message asks either one question (the historic shape: `choices` plus a
 * `selectedChoiceId`) or several (`questions` plus `answers`). Both end in the
 * same place — one string handed back as the tool result — because the agent
 * is waiting on a tool call, not on a form.
 */

/**
 * Validates a reply against what was actually asked.
 *
 * Every question must be answered, and a chosen id must be one of the options
 * offered *for that question*. Partial answers are refused rather than
 * half-applied: an agent that asked three things and is told two of them
 * proceeds on a guess about the third.
 */
export function normaliseAnswers(row: InboxRow, input: ReplyInboxInput): InboxAnswer[] {
  if (row.questions.length === 0) {
    return [];
  }
  const given = new Map((input.answers ?? []).map((answer) => [answer.questionId, answer]));

  // One question asked the old way, answered the old way: a single
  // `selectedChoiceId` still means the one question this message holds.
  if (given.size === 0 && input.selectedChoiceId && row.questions.length === 1) {
    given.set(row.questions[0]!.id, {
      questionId: row.questions[0]!.id,
      choiceId: input.selectedChoiceId,
    });
  }

  return row.questions.map((question) => {
    const answer = given.get(question.id);
    if (!answer) {
      throw new BadRequestException(`"${question.question}" was not answered`);
    }
    if (answer.choiceId && !question.choices.some((choice) => choice.id === answer.choiceId)) {
      throw new BadRequestException(
        `"${answer.choiceId}" is not one of the offered choices for "${question.question}"`,
      );
    }
    if (!answer.choiceId && !question.allowFreeText) {
      throw new BadRequestException(`"${question.question}" needs one of the offered choices`);
    }
    return {
      questionId: question.id,
      choiceId: answer.choiceId,
      text: answer.text?.trim() || undefined,
    };
  });
}

/**
 * The answer text the runner feeds back into the parked tool call.
 *
 * One question gets the answer alone — the agent knows what it asked, and
 * quoting its own question back at it is noise. Several get pairs, because
 * three labels in a row are not attributable to anything.
 */
export function renderAnswers(questions: InboxQuestion[], answers: InboxAnswer[]): string {
  if (questions.length === 1) {
    const question = questions[0]!;
    const answer = answers.find((candidate) => candidate.questionId === question.id);
    const chosen = question.choices.find((choice) => choice.id === answer?.choiceId)?.label;
    return [chosen, answer?.text].filter(Boolean).join(" — ") || "(no answer)";
  }
  return questions
    .map((question) => {
      const answer = answers.find((candidate) => candidate.questionId === question.id);
      const chosen = question.choices.find((choice) => choice.id === answer?.choiceId)?.label;
      const parts = [chosen, answer?.text].filter(Boolean);
      return `Q: ${question.question}\nA: ${parts.join(" — ") || "(no answer)"}`;
    })
    .join("\n\n");
}

/** How a multi-question message reads in the inbox list and the thread. */
export function summariseQuestions(questions: InboxQuestion[]): string {
  if (questions.length === 1) {
    return questions[0]!.question;
  }
  return questions.map((question, index) => `${index + 1}. ${question.question}`).join("\n");
}
