import type { DodItem } from "@agentos/shared";
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { projects } from "./projects";

/**
 * An open-ended loop (SPEC §11). The orchestrator keeps dispatching
 * specialists until every checkbox is ticked or a rail trips — the rails are
 * columns here rather than config so a running goal can never outlive them.
 */
export const goals = pgTable(
  "goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    spec: text("spec").notNull(),

    definitionOfDone: jsonb("definition_of_done")
      .$type<DodItem[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Nothing spawns before the operator signs off on the checklist. */
    dodApproved: boolean("dod_approved").notNull().default(false),

    status: text("status").notNull().default("draft"),
    stoppedReason: text("stopped_reason"),

    spendCapUsd: numeric("spend_cap_usd", { precision: 12, scale: 4 }),
    spendUsd: numeric("spend_usd", { precision: 12, scale: 4 }).notNull().default("0"),
    maxDurationMinutes: integer("max_duration_minutes"),
    stuckThreshold: integer("stuck_threshold").notNull().default(19),
    /** Consecutive iterations with no progress; reset by any real movement. */
    stuckCount: integer("stuck_count").notNull().default(0),
    iterations: integer("iterations").notNull().default(0),
    /**
     * Durable progress signals, counted rather than inferred.
     *
     * The stuck rail used to mean "the progress log got longer", which any
     * text at all satisfies — a specialist emitting boilerplate, or a failure
     * summary being appended. Only two things bump this: an agent explicitly
     * recording work with its activity tool, and a checklist item flipping to
     * done. Model prose does not.
     */
    progressMarks: integer("progress_marks").notNull().default(0),

    runnerPreference: text("runner_preference").notNull().default("auto"),
    /** Append-only, shared across every session on this goal. */
    progressLog: text("progress_log").notNull().default(""),
    /** Last specialist spawned, used by the stuck detector. */
    lastAgentName: text("last_agent_name"),

    startedAt: timestamp("started_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * Held while an iteration is dispatching. One goal, one specialist at a
     * time: without this, two iteration jobs each read the same remaining
     * spend and can each spend all of it before either records a cost.
     */
    dispatchLeaseAt: timestamp("dispatch_lease_at", { withTimezone: true }),
    /**
     * Who holds the lease above. Releasing without checking this let a worker
     * whose lease had already expired clear the lease of the worker that had
     * legitimately taken over, which permits a third dispatch against the same
     * remaining budget.
     */
    dispatchLeaseToken: text("dispatch_lease_token"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("goals_project_status_idx").on(table.projectId, table.status)],
);
