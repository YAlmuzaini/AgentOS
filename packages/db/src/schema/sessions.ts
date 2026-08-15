import type { ToolCallLogEntry } from "@agentos/shared";
import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { agents } from "./agents";
import { runnerEnum, sessionStatusEnum } from "./enums";
import { projects } from "./projects";
import { tasks } from "./tasks";

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    goalId: uuid("goal_id"),

    runner: runnerEnum("runner").notNull().default("cloud"),
    status: sessionStatusEnum("status").notNull().default("starting"),

    /** Managed Agents session id for the cloud runner. */
    runtimeHandle: text("runtime_handle"),
    /**
     * Vaults minted for this session's credentials. Persisted because destroy
     * has to delete them, and destroy can happen in a later process than the
     * one that created them — a resumed session, or the maintenance sweep.
     */
    runtimeVaultIds: jsonb("runtime_vault_ids")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    traceUrl: text("trace_url"),

    /**
     * Persisted before the container is destroyed, so a failed run is still
     * replayable in the viewer (SPEC §6).
     */
    toolCallLog: jsonb("tool_call_log")
      .$type<ToolCallLogEntry[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    commitShas: jsonb("commit_shas")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),

    costUsd: numeric("cost_usd", { precision: 12, scale: 4 }),
    error: text("error"),

    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * When this session parked on an inbox question. The reaper measures the
     * wait from here rather than from `startedAt`: a session that worked for
     * six hours and then asked something has been waiting for a minute, not
     * six hours.
     */
    parkedAt: timestamp("parked_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (table) => [
    index("sessions_project_started_idx").on(table.projectId, table.startedAt),
    index("sessions_task_idx").on(table.taskId),
  ],
);
