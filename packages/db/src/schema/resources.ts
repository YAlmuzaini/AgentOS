import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
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
    /**
     * The last time a real MCP handshake against this server succeeded.
     *
     * The distinction the UI is built on: a connection can be *cataloged* (we
     * wrote its URL down), *configured* (it exists here, maybe with a
     * credential), *granted* (an agent lists it), and only then *verified* —
     * meaning `initialize` and `tools/list` actually answered. Null means
     * nobody has ever checked, which is not the same as broken.
     */
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    /** Tool names the server reported at that handshake. Names only. */
    verifiedTools: jsonb("verified_tools")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** What the server or the network said, credential already stripped. */
    verifyError: text("verify_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("mcp_connections_project_name_key").on(table.projectId, table.name)],
);

/**
 * A GitHub App installation the operator approved on github.com.
 *
 * This is the alternative to pasting a personal access token. Nothing secret is
 * in this row: the installation id is a public identifier, and it is only
 * useful when combined with the App's private key, which stays in the secret
 * store. Cloning mints a fresh installation token that expires in an hour and
 * reaches only the repositories selected during installation.
 *
 * Project-scoped like every other resource, so connecting GitHub for one
 * project does not hand its repositories to another. The same installation may
 * be recorded in two projects deliberately; each project's repos resolve
 * against their own row.
 */
export const githubInstallations = pgTable(
  "github_installations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** GitHub's numeric installation id, as text — it is an identifier, not a number to sum. */
    installationId: text("installation_id").notNull(),
    /** The user or organisation the App was installed on, for the UI. */
    accountLogin: text("account_login").notNull().default(""),
    accountType: text("account_type").notNull().default(""),
    /** "all" or "selected", as GitHub reports it. */
    repositorySelection: text("repository_selection").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("github_installations_project_installation_key").on(
      table.projectId,
      table.installationId,
    ),
  ],
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
    /**
     * How a session authenticates to clone this repo. Exactly one of these is
     * used: the installation wins when both are set, because it is the
     * short-lived credential and the safer default.
     */
    githubInstallationId: uuid("github_installation_id").references(
      () => githubInstallations.id,
      { onDelete: "set null" },
    ),
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
    /**
     * True only for a skill AgentOS itself installed.
     *
     * The same provenance marker `agents` carries, and it exists for the same
     * reason: without it the installer cannot tell a shipped skill from an
     * operator's own skill that happens to share a slug, so it has to leave
     * every existing row alone — including the ones it wrote itself, which is
     * how three built-in skills sat in `general` with no description after the
     * category column arrived.
     */
    builtIn: boolean("built_in").notNull().default(false),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    /** What it does and when it applies. Read when picking a skill to grant. */
    description: text("description").notNull().default(""),
    /** One of `CATEGORY`, for grouping and filtering. Never null. */
    category: text("category").notNull().default("general"),
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
