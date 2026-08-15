import { z } from "zod";
import { ASSIGNEE_TYPES, SCHEDULE_KINDS, TASK_STATUSES } from "../enums";

export const createTaskSchema = z
  .object({
    name: z.string().min(1).max(300),
    description: z.string().default(""),
    assigneeType: z.enum(ASSIGNEE_TYPES).default("agent"),
    assigneeAgentId: z.string().uuid().nullable().default(null),
    attachmentIds: z.array(z.string().uuid()).default([]),
    /** When true no agent session may ever set status=done (SPEC §5.9). */
    approvalGate: z.boolean().default(false),
    scheduleKind: z.enum(SCHEDULE_KINDS).default("now"),
    runAt: z.coerce.date().nullable().default(null),
    cron: z.string().nullable().default(null),
    timezone: z.string().nullable().default(null),
  })
  .superRefine((value, ctx) => {
    if (value.assigneeType === "agent" && !value.assigneeAgentId) {
      ctx.addIssue({
        code: "custom",
        path: ["assigneeAgentId"],
        message: "an agent-assigned task needs assigneeAgentId",
      });
    }
    if (value.scheduleKind === "at" && !value.runAt) {
      ctx.addIssue({
        code: "custom",
        path: ["runAt"],
        message: "scheduleKind=at needs runAt",
      });
    }
    if (value.scheduleKind === "cron" && (!value.cron || !value.timezone)) {
      ctx.addIssue({
        code: "custom",
        path: ["cron"],
        message: "scheduleKind=cron needs cron and timezone",
      });
    }
  });
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

/** Human edits. Agent sessions patch through a narrower, ACL-checked path. */
export const patchTaskSchema = z.object({
  name: z.string().min(1).max(300).optional(),
  description: z.string().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  assigneeAgentId: z.string().uuid().nullable().optional(),
  approvalGate: z.boolean().optional(),
});
export type PatchTaskInput = z.infer<typeof patchTaskSchema>;

export interface TaskDto {
  id: string;
  projectId: string;
  name: string;
  description: string;
  status: (typeof TASK_STATUSES)[number];
  assigneeType: (typeof ASSIGNEE_TYPES)[number];
  assigneeAgentId: string | null;
  attachmentIds: string[];
  approvalGate: boolean;
  chainId: string | null;
  chainIndex: number | null;
  templateId: string | null;
  scheduleKind: (typeof SCHEDULE_KINDS)[number];
  runAt: string | null;
  cron: string | null;
  timezone: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskActivityDto {
  id: string;
  taskId: string;
  sessionId: string | null;
  agentId: string | null;
  body: string;
  createdAt: string;
}
