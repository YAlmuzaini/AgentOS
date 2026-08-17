import type { SessionAccess, SessionPublish, ToolCallLogEntry } from "@agentos/shared";
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
    /**
     * When the runtime was provably destroyed.
     *
     * Teardown writes a terminal status *before* it destroys the container, so
     * `destroyed` alone does not mean the container is gone — and
     * `runtimeHandle` is kept afterwards for the record, so it cannot tell the
     * two apart either. Deleting a session in that window leaves a runtime with
     * nothing pointing at it and no handle for the retry. Null with a handle
     * set means: still out there.
     */
    runtimeReleasedAt: timestamp("runtime_released_at", { withTimezone: true }),
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
    /**
     * What happened when the worker tried to push this session's commits.
     *
     * Only the local backend fills this in; the cloud runtime pushes from
     * inside its own container. It is recorded *before* the workspace is
     * destroyed, because after that there is no one left to ask — and a failed
     * push is the case where the operator has to go and find a directory the
     * worker deliberately kept.
     *
     * Null means the question was never asked: a cloud session, or a run that
     * ended before any repository was involved.
     */
    publish: jsonb("publish").$type<SessionPublish>(),

    /**
     * What this session was given, as it was decided at provision (SPEC §13).
     *
     * Recorded rather than derived: grants are read from the agent, and an
     * agent edited after a run would rewrite the history of every session it
     * ever had. Names and keys only — never a secret value.
     */
    access: jsonb("access").$type<SessionAccess>(),

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
