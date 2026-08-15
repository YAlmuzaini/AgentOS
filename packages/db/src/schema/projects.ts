import { sql } from "drizzle-orm";
import { jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { networkingModeEnum } from "./enums";

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    /** Canonical agentos.yml projection. Populated by the CLI in Phase 6. */
    yaml: text("yaml").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("projects_slug_key").on(table.slug)],
);

/**
 * Network policy — the second wall (SPEC §5.5). `limited` means deny-by-default
 * at the container's egress; MCP grants do not widen it.
 */
export const environments = pgTable(
  "environments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    networking: networkingModeEnum("networking").notNull().default("limited"),
    allowedHosts: jsonb("allowed_hosts")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Runtime environment id (Managed Agents `env_...`), created lazily. */
    runtimeEnvironmentId: text("runtime_environment_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("environments_project_name_key").on(table.projectId, table.name)],
);
