import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { agents } from "./agents";
import { assigneeTypeEnum, scheduleKindEnum, taskStatusEnum } from "./enums";
import { projects } from "./projects";

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    status: taskStatusEnum("status").notNull().default("todo"),
    assigneeType: assigneeTypeEnum("assignee_type").notNull().default("agent"),
    assigneeAgentId: uuid("assignee_agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    attachmentIds: jsonb("attachment_ids")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /**
     * Enforced server-side: an agent-scoped caller is refused status=done on a
     * gated task (SPEC §5.9). Not honour-system.
     */
    approvalGate: boolean("approval_gate").notNull().default(false),

    // Template chain position (Phase 3).
    chainId: uuid("chain_id"),
    chainIndex: integer("chain_index"),
    templateId: uuid("template_id"),

    /**
     * Set when another agent spawned this card off its collaboration list
     * (SPEC §5.10). No foreign key on the parent: a spawned card outlives the
     * card that asked for it, and the report it carries is the point.
     */
    parentTaskId: uuid("parent_task_id"),
    spawnedByAgentId: uuid("spawned_by_agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    spawnedBySessionId: uuid("spawned_by_session_id"),
    /**
     * How many spawns deep this card is. A reviewer that may spawn its own
     * helpers is a loop waiting to happen, so the depth is stored rather than
     * walked: the ceiling is checked in one read.
     */
    spawnDepth: integer("spawn_depth").notNull().default(0),

    scheduleKind: scheduleKindEnum("schedule_kind").notNull().default("now"),
    runAt: timestamp("run_at", { withTimezone: true }),
    cron: text("cron"),
    timezone: text("timezone"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("tasks_project_status_idx").on(table.projectId, table.status),
    index("tasks_chain_idx").on(table.chainId, table.chainIndex),
    index("tasks_parent_idx").on(table.parentTaskId),
    index("tasks_spawned_by_session_idx").on(table.spawnedBySessionId),
  ],
);

/** Progress notes agents write while working. Rendered next to the card. */
export const taskActivity = pgTable(
  "task_activity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id"),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("task_activity_task_idx").on(table.taskId, table.createdAt)],
);
