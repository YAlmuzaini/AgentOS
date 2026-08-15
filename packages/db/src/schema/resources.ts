import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { environments, projects } from "./projects";

/**
 * Everything an agent can be *granted*. Each row is inert on its own — it only
 * reaches a container when an agent lists it (SPEC §5.1, default deny).
 */

/**
 * A pointer into the secret store, never the secret itself (SPEC §5.8). Even
 * with the app database in hand, an attacker gets a name, not a token.
 */
export const secretRefs = pgTable(
  "secret_refs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Resolved by the configured secrets provider (env var name, KMS path, …). */
    providerRef: text("provider_ref").notNull(),
    purpose: text("purpose").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("secret_refs_project_name_key").on(table.projectId, table.name)],
);

export const mcpConnections = pgTable(
  "mcp_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    url: text("url").notNull(),
    /** Which tools of the server the agent may call; empty means all of them. */
    allowedOperations: jsonb("allowed_operations")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    credentialSecretId: uuid("credential_secret_id").references(() => secretRefs.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("mcp_connections_project_name_key").on(table.projectId, table.name)],
);

export const repos = pgTable(
  "repos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    remoteUrl: text("remote_url").notNull(),
    mountPath: text("mount_path").notNull(),
    credentialSecretId: uuid("credential_secret_id").references(() => secretRefs.id, {
      onDelete: "set null",
    }),
    defaultBranch: text("default_branch").notNull().default("main"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("repos_project_name_key").on(table.projectId, table.name)],
);

export const skills = pgTable(
  "skills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    /** `prompt` inlines the body; `file` points at the agent filesystem. */
    kind: text("kind").notNull().default("prompt"),
    body: text("body").notNull().default(""),
    filePath: text("file_path"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("skills_project_slug_key").on(table.projectId, table.slug)],
);

/** Environment variables handed to a session, by secret reference only. */
export const envBindings = pgTable(
  "env_bindings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /**
     * The environment this variable belongs to — SPEC §5.6: a secret is
     * injected "only if the agent/environment lists them". Nullable so the
     * migration cannot destroy rows written before this column existed; an
     * unassigned binding matches no environment and is therefore never
     * injected. Fail closed, then let the operator assign it.
     */
    environmentId: uuid("environment_id").references(() => environments.id, {
      onDelete: "cascade",
    }),
    /** The variable name the container sees. */
    key: text("key").notNull(),
    secretId: uuid("secret_id")
      .notNull()
      .references(() => secretRefs.id, { onDelete: "cascade" }),
    /** Hosts the value may be substituted into at egress; empty means any. */
    allowedHosts: jsonb("allowed_hosts")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Keyed per environment: the same variable name legitimately holds a
  // different secret in `staging` than in `production`.
  (table) => [
    uniqueIndex("env_bindings_environment_key_key").on(table.environmentId, table.key),
  ],
);

/** Index of what lives on the agent filesystem. Content lives in object storage. */
export const fileObjects = pgTable(
  "file_objects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    bucketKey: text("bucket_key").notNull(),
    mime: text("mime").notNull().default("application/octet-stream"),
    size: bigint("size", { mode: "number" }).notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("file_objects_project_path_key").on(table.projectId, table.path),
    index("file_objects_project_idx").on(table.projectId),
  ],
);
