/**
 * Domain enums shared by the API, the web UI, and the CLI.
 * One source of truth (RECIPE A2) — Drizzle derives its pgEnums from these.
 */

export const TASK_STATUSES = ["todo", "doing", "review", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const ASSIGNEE_TYPES = ["agent", "human"] as const;
export type AssigneeType = (typeof ASSIGNEE_TYPES)[number];

export const SCHEDULE_KINDS = ["now", "at", "cron"] as const;
export type ScheduleKind = (typeof SCHEDULE_KINDS)[number];

/**
 * Session state machine (SPEC §6). `waiting-inbox` is entered when the agent
 * calls an inbox tool that needs a human answer; the runtime session idles and
 * only resumes when the operator replies.
 */
export const SESSION_STATUSES = [
  "starting",
  "running",
  "waiting-inbox",
  "committing",
  "destroyed",
  "failed",
] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const RUNNERS = ["cloud", "local"] as const;
export type Runner = (typeof RUNNERS)[number];

export const RUNNER_PREFERENCES = ["cloud", "local", "inherit"] as const;
export type RunnerPreference = (typeof RUNNER_PREFERENCES)[number];

export const NETWORKING_MODES = ["open", "limited"] as const;
export type NetworkingMode = (typeof NETWORKING_MODES)[number];

export const REPO_PERMISSIONS = ["git-read", "git-write"] as const;
export type RepoPermission = (typeof REPO_PERMISSIONS)[number];

export const INBOX_SENDERS = ["agent", "human"] as const;
export type InboxSender = (typeof INBOX_SENDERS)[number];

export const INBOX_KINDS = ["text", "multiple-choice"] as const;
export type InboxKind = (typeof INBOX_KINDS)[number];

export const INBOX_STATUSES = ["open", "answered", "closed"] as const;
export type InboxStatus = (typeof INBOX_STATUSES)[number];

/** A session is finished when it can never emit another tool call. */
export const TERMINAL_SESSION_STATUSES: readonly SessionStatus[] = [
  "destroyed",
  "failed",
];

export function isTerminalSessionStatus(status: SessionStatus): boolean {
  return TERMINAL_SESSION_STATUSES.includes(status);
}
