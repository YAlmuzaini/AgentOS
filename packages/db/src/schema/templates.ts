import type { TemplateStep } from "@agentos/shared";
import { sql } from "drizzle-orm";
import { jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { projects } from "./projects";

/**
 * A chain of follow-up tasks (SPEC §9.4 / §10). Instantiating one creates
 * every card up front; ordering is enforced by the chain scheduler, which only
 * runs step N+1 once step N is `done`.
 */
export const taskTemplates = pgTable(
  "task_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    variables: jsonb("variables")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    steps: jsonb("steps")
      .$type<TemplateStep[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("task_templates_project_name_key").on(table.projectId, table.name)],
);
