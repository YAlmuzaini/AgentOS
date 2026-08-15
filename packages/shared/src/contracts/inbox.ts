import { z } from "zod";
import { INBOX_KINDS, INBOX_SENDERS, INBOX_STATUSES } from "../enums";

export const inboxChoiceSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
});
export type InboxChoice = z.infer<typeof inboxChoiceSchema>;

/** Operator reply. Answering an open message resumes the waiting session. */
export const replyInboxSchema = z
  .object({
    body: z.string().optional(),
    selectedChoiceId: z.string().optional(),
  })
  .refine((value) => Boolean(value.body?.trim() || value.selectedChoiceId), {
    message: "reply needs body or selectedChoiceId",
  });
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
  status: (typeof INBOX_STATUSES)[number];
  /** Set when the operator answered; the runner reads this to resume. */
  answeredAt: string | null;
  createdAt: string;
}
