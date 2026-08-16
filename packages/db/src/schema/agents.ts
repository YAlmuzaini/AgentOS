import type { FilesystemGrant, RepoAccess } from "@agentos/shared";
import { sql } from "drizzle-orm";
import {
  boolean,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { runnerPreferenceEnum } from "./enums";
import { environments, projects } from "./projects";

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * True only for an agent AgentOS itself installed.
     *
     * Without it "install built-ins" reconciles by name, and an operator's own
     * agent that happens to be called `plan` has its role prompt — which *is*
     * its behaviour — silently rewritten. The installer only updates rows it
     * created; anything else is left alone.
     */
    builtIn: boolean("built_in").notNull().default(false),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    title: text("title").notNull(),
    model: text("model").notNull(),
    foundationalPrompt: text("foundational_prompt").notNull(),
    rolePrompt: text("role_prompt").notNull(),

    // Grants. Empty means denied — there is no implicit access (SPEC §5.1).
    skillIds: jsonb("skill_ids")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    mcpConnectionIds: jsonb("mcp_connection_ids")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    repoAccess: jsonb("repo_access")
      .$type<RepoAccess[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    filesystemGrants: jsonb("filesystem_grants")
      .$type<FilesystemGrant[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    collaborationList: jsonb("collaboration_list")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),

    environmentId: uuid("environment_id").references(() => environments.id, {
      onDelete: "set null",
    }),
    runnerPreference: runnerPreferenceEnum("runner_preference").notNull().default("inherit"),
    inboxAccess: boolean("inbox_access").notNull().default(true),

    /** Runtime agent id + pinned version (Managed Agents `agent_...`). */
    runtimeAgentId: text("runtime_agent_id"),
    runtimeAgentVersion: text("runtime_agent_version"),
    /** Hash of the fields that make up the runtime agent, to detect drift. */
    runtimeConfigHash: text("runtime_config_hash"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("agents_project_name_key").on(table.projectId, table.name)],
);
