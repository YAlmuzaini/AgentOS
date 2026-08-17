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

/**
 * What one session was actually given, recorded when it was provisioned
 * (SPEC §6, §13).
 *
 * The manifest is decided per session from the agent's grants, so an agent
 * edited afterwards tells you nothing about the run you are looking at. This
 * is the record of what that container could reach while it ran.
 *
 * **Names only.** Environment variables appear as keys, MCP connections and
 * repositories as names — never a value, a URL with a credential in it, or a
 * token. The whole point of the manifest is that it is safe to show.
 */
export const sessionAccessSchema = z.object({
  model: z.string().default(""),
  /** Control-plane tools this session was handed. */
  tools: z.array(z.string()).default([]),
  mcpServers: z
    .array(z.object({ name: z.string(), allowedOperations: z.array(z.string()).default([]) }))
    .default([]),
  repos: z
    .array(
      z.object({
        name: z.string(),
        mountPath: z.string(),
        permissions: z.enum(["git-read", "git-write"]),
      }),
    )
    .default([]),
  /** Keys only. A value here would be a credential on a screen. */
  envVarKeys: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
  folders: z.array(z.string()).default([]),
  collaborators: z.array(z.string()).default([]),
  networking: z.enum(["open", "limited"]).default("limited"),
  allowedHosts: z.array(z.string()).default([]),
});
export type SessionAccess = z.infer<typeof sessionAccessSchema>;

/**
 * What happened when the local worker tried to push a session's commits.
 *
 * Safe to show, like everything else on a session row: repository and branch
 * names, a sha, and an error string the worker has already stripped of any
 * credential git may have quoted back at it.
 */
export const sessionPublishSchema = z.object({
  records: z
    .array(
      z.object({
        repo: z.string(),
        branch: z.string(),
        pushed: z.boolean(),
        remoteSha: z.string().nullable().default(null),
        commits: z.number().int().nonnegative().default(0),
        error: z.string().nullable().default(null),
      }),
    )
    .default([]),
  /**
   * Where the worker kept the workspace because a push failed, so the operator
   * can go and recover commits that exist nowhere else. Null is the normal case.
   */
  retainedWorkspace: z.string().nullable().default(null),
});
export type SessionPublish = z.infer<typeof sessionPublishSchema>;

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
  /** Null for sessions that ran before this was recorded. */
  access: SessionAccess | null;
  /** Local sessions only. Null when no push was attempted. */
  publish: SessionPublish | null;
  /** Name of the agent that ran, so a session reads without a second fetch. */
  agentName: string | null;
}

/**
 * What `GET /sessions` returns.
 *
 * The tool-call log is deliberately absent. A finished run's log is the bulk of
 * a session row, the list renders none of it, and the list is polled every few
 * seconds by the session viewer and the top bar — shipping every log on every
 * poll made the list two orders of magnitude larger than the data it displays.
 * Fetch a single session (`GET /sessions/:id`) to replay its log.
 */
export type SessionSummaryDto = Omit<SessionDto, "toolCallLog">;
