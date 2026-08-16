import { z } from "zod";
import { NETWORKING_MODES } from "../enums";
import { slugSchema } from "./project";

/* ── Environments — the network wall (SPEC §5.5) ───────────────────────── */

export const createEnvironmentSchema = z.object({
  name: slugSchema,
  networking: z.enum(NETWORKING_MODES).default("limited"),
  /** Only meaningful when networking is `limited`. */
  allowedHosts: z.array(z.string().min(1)).default([]),
});
export type CreateEnvironmentInput = z.infer<typeof createEnvironmentSchema>;

export const updateEnvironmentSchema = createEnvironmentSchema.partial().omit({ name: true });
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

export const createMcpConnectionSchema = z.object({
  name: slugSchema,
  url: z.string().url(),
  allowedOperations: z.array(z.string().min(1)).default([]),
  credentialSecretId: z.string().uuid().nullable().default(null),
});
export type CreateMcpConnectionInput = z.infer<typeof createMcpConnectionSchema>;

export interface McpConnectionDto {
  id: string;
  projectId: string;
  name: string;
  url: string;
  allowedOperations: string[];
  credentialSecretId: string | null;
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
  remoteUrl: z.string().url(),
  mountPath: mountPathSchema,
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
  credentialSecretId: string | null;
  defaultBranch: string;
}

/* ── Skills ────────────────────────────────────────────────────────────── */

export const SKILL_KINDS = ["prompt", "file"] as const;

export const createSkillSchema = z
  .object({
    name: z.string().min(1).max(200),
    slug: slugSchema,
    kind: z.enum(SKILL_KINDS).default("prompt"),
    body: z.string().default(""),
    filePath: z.string().nullable().default(null),
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
  kind: (typeof SKILL_KINDS)[number];
  body: string;
  filePath: string | null;
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
