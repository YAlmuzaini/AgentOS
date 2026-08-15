import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { agents } from "./agents";
import { projects } from "./projects";
import { taskTemplates } from "./templates";

/**
 * Inbound webhooks (SPEC §14). A valid POST spawns one scoped job — the
 * trigger's agent, nothing wider.
 *
 * The signing key is never stored: only a random salt is, and the key is
 * derived from it plus a master secret held in the environment. A stolen
 * database therefore yields no usable webhook credentials (SPEC §5.8).
 */
export const triggers = pgTable(
  "triggers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    /** How the payload becomes a task description. */
    jobPrompt: text("job_prompt").notNull().default(""),
    /** Salt for key derivation. Rotating it invalidates the old key. */
    secretSalt: text("secret_salt").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("triggers_project_name_key").on(table.projectId, table.name)],
);

/** Every delivery attempt, accepted or rejected. */
export const triggerFires = pgTable(
  "trigger_fires",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    triggerId: uuid("trigger_id")
      .notNull()
      .references(() => triggers.id, { onDelete: "cascade" }),
    accepted: boolean("accepted").notNull(),
    reason: text("reason"),
    taskId: uuid("task_id"),
    /**
     * The delivery's signature. A valid signed request stays valid until its
     * timestamp ages out, so without this a captured POST could be replayed
     * for the length of the window — each replay spawning another container.
     * Unique, so the replay loses the race at the database rather than in
     * application code.
     */
    signature: text("signature"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("trigger_fires_trigger_idx").on(table.triggerId, table.createdAt),
    uniqueIndex("trigger_fires_signature_key").on(table.triggerId, table.signature),
  ],
);

/**
 * Named cron entries (SPEC §15). Distinct from a task's own recurring
 * schedule: an automation is a standing entry in the sidebar that creates work,
 * rather than a task that repeats.
 */
export const automations = pgTable(
  "automations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    cron: text("cron").notNull(),
    timezone: text("timezone").notNull().default("UTC"),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    taskTemplateId: uuid("task_template_id").references(() => taskTemplates.id, {
      onDelete: "set null",
    }),
    /** Inline task when no template is used. */
    taskName: text("task_name").notNull().default(""),
    taskBody: text("task_body").notNull().default(""),
    templateVariables: jsonb("template_variables")
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    enabled: boolean("enabled").notNull().default(true),
    lastFiredAt: timestamp("last_fired_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("automations_project_name_key").on(table.projectId, table.name)],
);
