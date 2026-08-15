import { boolean, integer, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
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

  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
