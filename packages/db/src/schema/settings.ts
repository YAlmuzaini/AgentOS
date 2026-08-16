import { boolean, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { projects } from "./projects";

/**
 * Operator-tunable policy, one row per project.
 *
 * Everything here is a decision the operator is allowed to change at runtime.
 * Deployment facts — database URLs, credentials, the operator token — stay in
 * env, because a setting you can edit from a browser is not a secret.
 *
 * A project with no row uses the defaults in `settings.service.ts`.
 */
export const projectSettings = pgTable("project_settings", {
  projectId: uuid("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),

  /**
   * How long a session parked on an inbox question may hold its container
   * before AgentOS gives up on the answer. 0 disables the reaper entirely —
   * the container then waits forever, which is a real choice and an expensive
   * one.
   */
  parkedSessionTimeoutMinutes: integer("parked_session_timeout_minutes").notNull().default(1440),

  /** Whether to reconcile runtime containers AgentOS has no session for. */
  orphanSweepEnabled: boolean("orphan_sweep_enabled").notNull().default(true),

  /** How often that reconciliation runs. */
  orphanSweepIntervalMinutes: integer("orphan_sweep_interval_minutes").notNull().default(15),

  /**
   * Which backend runs a session when the agent does not name one.
   *
   * This is the money switch. `cloud` bills the Anthropic API per token;
   * `local` runs Claude Code on a machine the operator owns, against a
   * subscription, at a flat rate. `auto` prefers local when it is reachable and
   * falls back to cloud, so losing the worker degrades cost rather than
   * availability.
   *
   * A setting rather than an env var because it is a judgement the operator
   * revises — where the local worker *lives* (`LOCAL_RUNNER_URL`) is the
   * deployment fact, and that stays in env.
   */
  defaultRunner: text("default_runner").notNull().default("auto"),

  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
