import { z } from "zod";
import { CATEGORIES, type Category } from "../catalog/categories";
import { NETWORKING_MODES } from "../enums";
import { patchSchema } from "./patch";
import { provenanceSchema, type Provenance } from "./provenance";
import { slugSchema } from "./project";
import { hasUrlCredential } from "./url-safety";

/* ── Environments — the network wall (SPEC §5.5) ───────────────────────── */

export const createEnvironmentSchema = z.object({
  name: slugSchema,
  networking: z.enum(NETWORKING_MODES).default("limited"),
  /** Only meaningful when networking is `limited`. */
  allowedHosts: z.array(z.string().min(1)).default([]),
});
export type CreateEnvironmentInput = z.infer<typeof createEnvironmentSchema>;

export const updateEnvironmentSchema = patchSchema(createEnvironmentSchema).omit({ name: true });
export type UpdateEnvironmentInput = z.infer<typeof updateEnvironmentSchema>;

export interface EnvironmentDto {
  id: string;
  projectId: string;
  name: string;
  networking: (typeof NETWORKING_MODES)[number];
  allowedHosts: string[];
}

/* ── Secrets — references only, never values (SPEC §5.8) ───────────────── */

export const SECRET_PURPOSES = ["mcp", "repo", "env", "webhook"] as const;
export type SecretPurpose = (typeof SECRET_PURPOSES)[number];

export const createSecretRefSchema = z.object({
  name: slugSchema,
  /** Resolved by the configured provider — an env var name in dev. */
  providerRef: z.string().min(1),
  purpose: z.enum(SECRET_PURPOSES),
});
export type CreateSecretRefInput = z.infer<typeof createSecretRefSchema>;

export interface SecretRefDto {
  id: string;
  projectId: string;
  name: string;
  providerRef: string;
  purpose: SecretPurpose;
  /** Whether the provider can currently resolve it. Never the value itself. */
  resolvable: boolean;
}

/* ── MCP connections ───────────────────────────────────────────────────── */

/**
 * An MCP endpoint URL, refused if it carries the credential itself.
 *
 * AgentOS stores secrets as *references* and never as values (SPEC §5.8), and
 * a URL is neither — it is stored verbatim, returned by the API, and rendered
 * on a screen. `https://user:secret@host/mcp` and `?api_key=…` both walked
 * straight through `z.string().url()` and put a live credential in the
 * database, where the verifier's later refusal was far too late to matter.
 *
 * Userinfo is unambiguous and always refused. Query parameters are judged by
 * name, and only names that mean nothing else: the catalogue's own URLs carry
 * `tools`, `telemetry-enabled` and `exaApiKey`, and legitimate configuration
 * must keep working. A server that hides its key in a *path* segment cannot be
 * caught this way at all — that limitation is documented rather than pretended
 * away.
 */
export const mcpUrlSchema = z
  .string()
  .url()
  .refine((value) => !hasUrlCredential(value), {
    message:
      "put the credential in a secret reference rather than in the URL — a URL is stored and " +
      "displayed verbatim, so anything in it is a secret in the database",
  });

export const createMcpConnectionSchema = z.object({
  name: slugSchema,
  url: mcpUrlSchema,
  allowedOperations: z.array(z.string().min(1)).default([]),
  credentialSecretId: z.string().uuid().nullable().default(null),
  provenance: provenanceSchema.optional(),
});
export type CreateMcpConnectionInput = z.infer<typeof createMcpConnectionSchema>;

/**
 * Editing a connection after it exists.
 *
 * `name` is deliberately absent. It is the key `agentos.yml` and the built-in
 * installer reconcile on, and it is what a session's manifest calls the server;
 * renaming through this door would orphan the YAML entry and silently change
 * what an agent's prompt says it holds. Delete and recreate instead.
 *
 * Everything here is a partial: sending `{ credentialSecretId }` alone attaches
 * a credential without touching a carefully narrowed URL, which is the common
 * case straight after installing a built-in. `patchSchema` rather than
 * `.partial()` is what makes that sentence true — see its own comment.
 */
export const updateMcpConnectionSchema = patchSchema(createMcpConnectionSchema).omit({
  name: true,
});
export type UpdateMcpConnectionInput = z.infer<typeof updateMcpConnectionSchema>;

export interface McpConnectionDto {
  id: string;
  projectId: string;
  name: string;
  url: string;
  allowedOperations: string[];
  credentialSecretId: string | null;
  /** ISO timestamp of the last successful handshake, or null if never checked. */
  verifiedAt: string | null;
  /** Tool names the server reported. Names only — never schemas or values. */
  verifiedTools: string[];
  /** Why the last check failed. Credential-free by construction. */
  verifyError: string | null;
  provenance: Provenance;
}

/* ── Repos ─────────────────────────────────────────────────────────────── */

/**
 * Where a repo is mounted inside a session.
 *
 * Absolute and traversal-free. A leading slash alone is not enough: the local
 * runner joins this onto its throwaway workspace directory, so `/../../tmp/x`
 * would clone outside the workspace and survive its cleanup.
 */
export const mountPathSchema = z
  .string()
  .startsWith("/")
  .refine((value) => !value.split("/").includes(".."), {
    message: "must not contain a `..` segment",
  })
  .refine((value) => !value.includes("\0"), { message: "must not contain a NUL byte" });

export const createRepoSchema = z.object({
  name: slugSchema,
  // The same rule as an MCP endpoint, for the same reason: `remoteUrl` is
  // stored verbatim and returned by `RepoDto`, so a credential in it is a
  // credential in the database and on the screen. The GitHub App check does
  // not close this — `normaliseRemote()` drops userinfo before comparing, so a
  // credential-bearing URL still matches its installation.
  remoteUrl: mcpUrlSchema,
  mountPath: mountPathSchema,
  /**
   * How a session authenticates the clone. A GitHub App installation is the
   * better of the two — the token it mints expires in an hour and reaches only
   * the repositories the operator selected — so it wins when both are set.
   */
  githubInstallationId: z.string().uuid().nullable().default(null),
  credentialSecretId: z.string().uuid().nullable().default(null),
  defaultBranch: z.string().min(1).default("main"),
});
export type CreateRepoInput = z.infer<typeof createRepoSchema>;

export interface RepoDto {
  id: string;
  projectId: string;
  name: string;
  remoteUrl: string;
  mountPath: string;
  githubInstallationId: string | null;
  credentialSecretId: string | null;
  defaultBranch: string;
}

/* ── Skills ────────────────────────────────────────────────────────────── */

export const SKILL_KINDS = ["prompt", "file"] as const;

export const createSkillSchema = z
  .object({
    name: z.string().min(1).max(200),
    slug: slugSchema,
    /** What it does and when it applies. Shown wherever a skill is granted. */
    description: z.string().max(1024).default(""),
    category: z.enum(CATEGORIES).default("general"),
    kind: z.enum(SKILL_KINDS).default("prompt"),
    body: z.string().default(""),
    filePath: z.string().nullable().default(null),
    provenance: provenanceSchema.optional(),
  })
  .refine((value) => (value.kind === "prompt" ? value.body.length > 0 : Boolean(value.filePath)), {
    message: "a prompt skill needs a body; a file skill needs a filePath",
  });
export type CreateSkillInput = z.infer<typeof createSkillSchema>;

export interface SkillDto {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  description: string;
  category: Category;
  kind: (typeof SKILL_KINDS)[number];
  body: string;
  filePath: string | null;
  provenance: Provenance;
}

/* ── Environment variable bindings ─────────────────────────────────────── */

export const createEnvBindingSchema = z.object({
  /** Which environment gets this variable. Sessions outside it never see it. */
  environmentId: z.string().uuid(),
  key: z
    .string()
    .min(1)
    .regex(/^[A-Z][A-Z0-9_]*$/, "must be SCREAMING_SNAKE_CASE"),
  secretId: z.string().uuid(),
  allowedHosts: z.array(z.string().min(1)).default([]),
});
export type CreateEnvBindingInput = z.infer<typeof createEnvBindingSchema>;

export interface EnvBindingDto {
  id: string;
  projectId: string;
  /** Null only for rows written before bindings were environment-scoped. */
  environmentId: string | null;
  key: string;
  secretId: string;
  allowedHosts: string[];
}

/* ── Agent filesystem ──────────────────────────────────────────────────── */

export interface FileEntryDto {
  path: string;
  kind: "file" | "folder";
  size: number;
  mime: string;
  updatedAt: string | null;
  /**
   * For a folder: how many files are under it, at any depth.
   *
   * A browser that shows a folder and nothing else leaves the operator to
   * click it to find out whether it holds anything — and on this disk most
   * folders belong to an agent that may never have written a thing.
   */
  childCount?: number;
}

export const writeFileSchema = z.object({
  path: z.string().startsWith("/"),
  content: z.string(),
  mime: z.string().default("text/plain"),
});
export type WriteFileInput = z.infer<typeof writeFileSchema>;
