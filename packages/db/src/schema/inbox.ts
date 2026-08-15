import type { InboxChoice } from "@agentos/shared";
import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents";
import { inboxKindEnum, inboxSenderEnum, inboxStatusEnum } from "./enums";
import { projects } from "./projects";
import { sessions } from "./sessions";
import { tasks } from "./tasks";

/**
 * The only human interrupt channel (SPEC §12). An open message from an agent
 * means its session is parked; answering it resumes that session.
 */
export const inboxMessages = pgTable(
  "inbox_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    from: inboxSenderEnum("from").notNull(),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    sessionId: uuid("session_id").references(() => sessions.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    goalId: uuid("goal_id"),

    kind: inboxKindEnum("kind").notNull().default("text"),
    body: text("body").notNull(),
    choices: jsonb("choices")
      .$type<InboxChoice[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    selectedChoiceId: text("selected_choice_id"),
    status: inboxStatusEnum("status").notNull().default("open"),

    /**
     * Runtime tool-use id this message is blocking on. The runner replies to
     * exactly this id to unblock the paused session.
     */
    runtimeToolUseId: text("runtime_tool_use_id"),
    runtimeThreadId: text("runtime_thread_id"),

    answeredAt: timestamp("answered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("inbox_project_status_idx").on(table.projectId, table.status, table.createdAt),
    index("inbox_session_idx").on(table.sessionId),
  ],
);
