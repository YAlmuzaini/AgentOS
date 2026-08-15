import {
  ASSIGNEE_TYPES,
  INBOX_KINDS,
  INBOX_SENDERS,
  INBOX_STATUSES,
  NETWORKING_MODES,
  RUNNERS,
  RUNNER_PREFERENCES,
  SCHEDULE_KINDS,
  SESSION_STATUSES,
  TASK_STATUSES,
} from "@agentos/shared";
import { pgEnum } from "drizzle-orm/pg-core";

// Postgres enums derive from the shared constants so the DB and the API can
// never drift apart (RECIPE A2: one source of truth).
export const taskStatusEnum = pgEnum("task_status", TASK_STATUSES);
export const assigneeTypeEnum = pgEnum("assignee_type", ASSIGNEE_TYPES);
export const scheduleKindEnum = pgEnum("schedule_kind", SCHEDULE_KINDS);
export const sessionStatusEnum = pgEnum("session_status", SESSION_STATUSES);
export const runnerEnum = pgEnum("runner", RUNNERS);
export const runnerPreferenceEnum = pgEnum("runner_preference", RUNNER_PREFERENCES);
export const networkingModeEnum = pgEnum("networking_mode", NETWORKING_MODES);
export const inboxSenderEnum = pgEnum("inbox_sender", INBOX_SENDERS);
export const inboxKindEnum = pgEnum("inbox_kind", INBOX_KINDS);
export const inboxStatusEnum = pgEnum("inbox_status", INBOX_STATUSES);
