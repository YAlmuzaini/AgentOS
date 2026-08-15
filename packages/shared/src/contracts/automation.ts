import { z } from "zod";
import { slugSchema } from "./project";

/* ── Triggers (SPEC §14) ───────────────────────────────────────────────── */

export const createTriggerSchema = z.object({
  name: slugSchema,
  agentId: z.string().uuid(),
  /**
   * Prepended to the sanitised payload. This is where the operator says what
   * the scoped agent should do with an inbound event.
   */
  jobPrompt: z.string().default(""),
  enabled: z.boolean().default(true),
});
export type CreateTriggerInput = z.infer<typeof createTriggerSchema>;

export interface TriggerDto {
  id: string;
  projectId: string;
  name: string;
  agentId: string;
  jobPrompt: string;
  enabled: boolean;
  /** Where the third party posts. */
  url: string;
  createdAt: string;
}

/** The signing key is shown once, at creation or rotation, and never again. */
export interface TriggerSecretDto extends TriggerDto {
  signingKey: string;
}

export interface TriggerFireDto {
  id: string;
  triggerId: string;
  accepted: boolean;
  reason: string | null;
  taskId: string | null;
  createdAt: string;
}

/* ── Automations (SPEC §15) ────────────────────────────────────────────── */

export const createAutomationSchema = z
  .object({
    name: slugSchema,
    cron: z.string().min(1),
    timezone: z.string().min(1).default("UTC"),
    agentId: z.string().uuid().nullable().default(null),
    taskTemplateId: z.string().uuid().nullable().default(null),
    taskName: z.string().default(""),
    taskBody: z.string().default(""),
    templateVariables: z.record(z.string(), z.string()).default({}),
    enabled: z.boolean().default(true),
  })
  .superRefine((value, ctx) => {
    if (!value.taskTemplateId && !value.agentId) {
      ctx.addIssue({
        code: "custom",
        path: ["agentId"],
        message: "an automation needs either a template or an agent to assign the task to",
      });
    }
    if (!value.taskTemplateId && !value.taskName.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["taskName"],
        message: "an inline automation needs a task name",
      });
    }
  });
export type CreateAutomationInput = z.infer<typeof createAutomationSchema>;

export interface AutomationDto {
  id: string;
  projectId: string;
  name: string;
  cron: string;
  timezone: string;
  agentId: string | null;
  taskTemplateId: string | null;
  taskName: string;
  taskBody: string;
  templateVariables: Record<string, string>;
  enabled: boolean;
  lastFiredAt: string | null;
}

/**
 * Reduces an inbound payload to something safe to put in a prompt.
 *
 * Headers, credentials and anything unbounded are dropped: the agent gets the
 * event, not the transport (SPEC §14).
 */
export function sanitizeWebhookPayload(payload: unknown, maxChars = 8000): string {
  const seen = new WeakSet<object>();
  const redactedKey = /(secret|token|password|authorization|api[-_]?key|signature)/i;

  const walk = (value: unknown, depth: number): unknown => {
    if (depth > 6) {
      return "…";
    }
    if (value === null || typeof value !== "object") {
      return typeof value === "string" && value.length > 2000 ? `${value.slice(0, 2000)}…` : value;
    }
    if (seen.has(value as object)) {
      return "[circular]";
    }
    seen.add(value as object);

    if (Array.isArray(value)) {
      return value.slice(0, 50).map((entry) => walk(entry, depth + 1));
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 100)
        .map(([key, entry]) => [key, redactedKey.test(key) ? "[redacted]" : walk(entry, depth + 1)]),
    );
  };

  const text = JSON.stringify(walk(payload, 0), null, 2) ?? "";
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n… (truncated)` : text;
}
