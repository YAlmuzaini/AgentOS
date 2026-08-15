import { z } from "zod";
import { RUNNERS, SESSION_STATUSES } from "../enums";

/**
 * One entry of the session's tool-call log. Mirrors what the live viewer
 * renders and what a finished run replays (SPEC §13).
 */
export const toolCallLogEntrySchema = z.object({
  at: z.string(),
  /** Raw runtime event type, e.g. "agent.tool_use" or "session.status_idle". */
  type: z.string(),
  /** Tool name when the event is a tool call. */
  name: z.string().nullable().default(null),
  /** Human-readable one-liner for the feed. */
  summary: z.string().default(""),
  /** Runtime event id, used to dedupe on stream reconnect. */
  eventId: z.string().nullable().default(null),
});
export type ToolCallLogEntry = z.infer<typeof toolCallLogEntrySchema>;

export interface SessionDto {
  id: string;
  projectId: string;
  agentId: string;
  taskId: string | null;
  goalId: string | null;
  runner: (typeof RUNNERS)[number];
  status: (typeof SESSION_STATUSES)[number];
  /** Runtime handle — the Managed Agents session id for the cloud runner. */
  runtimeHandle: string | null;
  /** Console trace URL for the runtime session, when the runner exposes one. */
  traceUrl: string | null;
  toolCallLog: ToolCallLogEntry[];
  commitShas: string[];
  costUsd: number | null;
  error: string | null;
  startedAt: string;
  endedAt: string | null;
}
