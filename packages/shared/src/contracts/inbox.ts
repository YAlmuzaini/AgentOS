import { z } from "zod";
import { INBOX_KINDS, INBOX_SENDERS, INBOX_STATUSES } from "../enums";

export const inboxChoiceSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
});
export type InboxChoice = z.infer<typeof inboxChoiceSchema>;

/**
 * One question inside a message (SPEC §12).
 *
 * An agent that needs three decisions asks for three at once rather than
 * parking three times: the operator is not at their desk, and each park is a
 * container held open until they get there.
 */
export const inboxQuestionSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  /** Why it is being asked, when the question alone does not carry it. */
  detail: z.string().default(""),
  choices: z.array(inboxChoiceSchema).min(2),
  /** Lets the operator answer in their own words instead of picking. */
  allowFreeText: z.boolean().default(false),
});
export type InboxQuestion = z.infer<typeof inboxQuestionSchema>;

export const inboxAnswerSchema = z
  .object({
    questionId: z.string().min(1),
    choiceId: z.string().optional(),
    text: z.string().optional(),
  })
  .refine((value) => Boolean(value.choiceId || value.text?.trim()), {
    message: "an answer needs a choiceId or text",
  });
export type InboxAnswer = z.infer<typeof inboxAnswerSchema>;

/**
 * Operator reply. Answering an open message resumes the waiting session.
 *
 * Three shapes, because messages come in three: free text for a note,
 * `selectedChoiceId` for a single question, and `answers` for a message that
 * asked several. The first two are what every message written before
 * multi-question support uses, so they stay.
 */
export const replyInboxSchema = z
  .object({
    body: z.string().optional(),
    selectedChoiceId: z.string().optional(),
    answers: z.array(inboxAnswerSchema).optional(),
  })
  .refine(
    (value) =>
      Boolean(value.body?.trim() || value.selectedChoiceId || (value.answers?.length ?? 0) > 0),
    { message: "reply needs body, selectedChoiceId or answers" },
  );
export type ReplyInboxInput = z.infer<typeof replyInboxSchema>;

export interface InboxMessageDto {
  id: string;
  projectId: string;
  from: (typeof INBOX_SENDERS)[number];
  agentId: string | null;
  sessionId: string | null;
  taskId: string | null;
  goalId: string | null;
  kind: (typeof INBOX_KINDS)[number];
  body: string;
  choices: InboxChoice[];
  selectedChoiceId: string | null;
  /** Every question this message asks; empty for a plain note. */
  questions: InboxQuestion[];
  answers: InboxAnswer[];
  status: (typeof INBOX_STATUSES)[number];
  /** Set when the operator answered; the runner reads this to resume. */
  answeredAt: string | null;
  createdAt: string;
  /**
   * Who asked, and about what.
   *
   * Resolved server-side because the alternative is a message that says only
   * "waiting on you": the operator opening this at 23:00 needs to know which
   * agent is blocked and on which card before they can answer anything.
   */
  agentName: string | null;
  subject: { kind: "task" | "goal"; id: string; name: string } | null;
}
