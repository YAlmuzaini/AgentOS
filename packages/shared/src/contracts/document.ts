import { z } from "zod";
import { CATEGORIES } from "../catalog/categories";
import { NETWORKING_MODES, REPO_PERMISSIONS, RUNNER_PREFERENCES } from "../enums";
import { mcpUrlSchema, mountPathSchema } from "./resources";
import { filesystemGrantSchema } from "./agent";
import { slugSchema } from "./project";
import { templateStepSchema } from "./template";
import { ORIGINAL_PROVENANCE, provenanceSchema } from "./provenance";

/**
 * `agentos.yml` — the project as code (SPEC §17).
 *
 * The document mirrors the UI rather than the database: agents reference
 * skills, MCP connections and repos by *name*, so a file can be written by
 * hand, diffed, and applied to a fresh project without knowing any ids.
 */

export const documentEnvironmentSchema = z.object({
  networking: z.enum(NETWORKING_MODES).default("limited"),
  allowedHosts: z.array(z.string().min(1)).default([]),
});

export const documentAgentSchema = z.object({
  title: z.string().min(1),
  /**
   * Defaulted rather than required, so a hand-written agent stays three lines
   * long. `pull` always writes it, which is what keeps push-then-pull an
   * identity once the field exists on the row.
   */
  description: z.string().max(1024).default(""),
  category: z.enum(CATEGORIES).default("general"),
  model: z.string().min(1),
  prompt: z.string().min(1),
  skills: z.array(slugSchema).default([]),
  mcp: z.array(slugSchema).default([]),
  repos: z
    .array(
      z.object({
        name: slugSchema,
        mount: z.string().startsWith("/"),
        permissions: z.enum(REPO_PERMISSIONS).default("git-read"),
      }),
    )
    .default([]),
  filesystem: z.array(filesystemGrantSchema).default([]),
  collaboration: z.array(slugSchema).default([]),
  environment: slugSchema.nullable().default(null),
  runner: z.enum(RUNNER_PREFERENCES).default("inherit"),
  inbox: z.boolean().default(true),
  provenance: provenanceSchema.default(ORIGINAL_PROVENANCE),
  /**
   * Catalogue ownership. `agentos.yml` is operator-controlled, so this is a
   * declaration, not a lock: setting it true opts the row into the built-in
   * installer's update behaviour (title, description, category, prompts and
   * provenance are refreshed on re-install); false keeps the row the
   * operator's and untouched. It round-trips so that a pull → push cycle does
   * not silently convert the shipped catalogue into operator-authored rows.
   */
  builtIn: z.boolean().default(false),
});

export const documentSkillSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().max(1024).default(""),
    category: z.enum(CATEGORIES).default("general"),
    kind: z.enum(["prompt", "file"]).default("prompt"),
    body: z.string().default(""),
    filePath: z.string().nullable().default(null),
    provenance: provenanceSchema.default(ORIGINAL_PROVENANCE),
    /** See `documentAgentSchema.builtIn`. */
    builtIn: z.boolean().default(false),
  })
  // The same rule the REST schema enforces. A file skill with no path renders
  // in a session prompt as "no path recorded", which is a broken grant that
  // looks like a working one.
  .refine((value) => (value.kind === "prompt" ? value.body.length > 0 : Boolean(value.filePath)), {
    message: "a prompt skill needs a body; a file skill needs a filePath",
  });

export const documentTemplateSchema = z.object({
  description: z.string().default(""),
  variables: z.array(z.string().min(1)).default([]),
  steps: z.array(templateStepSchema).min(1),
  provenance: provenanceSchema.default(ORIGINAL_PROVENANCE),
  /** See `documentAgentSchema.builtIn`. */
  builtIn: z.boolean().default(false),
});

export const documentMcpSchema = z.object({
  // The same rule the REST door enforces: a credential in a URL is a secret in
  // the database, and `agentos push` must not be the way around that.
  url: mcpUrlSchema,
  allowedOperations: z.array(z.string().min(1)).default([]),
  /** Name of a secret reference, resolved by the control plane. */
  credential: slugSchema.nullable().default(null),
  provenance: provenanceSchema.default(ORIGINAL_PROVENANCE),
});

export const documentRepoSchema = z.object({
  // As at the REST door: `agentos push` must not be the way to get a
  // credential into a stored URL.
  remoteUrl: mcpUrlSchema,
  // Shared with the REST schema on purpose: YAML is a second door into the
  // same database, and a traversal-bearing mount path is no safer for having
  // arrived through a file.
  mountPath: mountPathSchema,
  defaultBranch: z.string().min(1).default("main"),
  credential: slugSchema.nullable().default(null),
});

export const agentosDocumentSchema = z.object({
  project: slugSchema,
  companyProfiles: z.record(slugSchema, z.object({
    version: z.string().min(1),
    provenance: provenanceSchema.default(ORIGINAL_PROVENANCE),
  })).default({}),
  agentPacks: z.record(slugSchema, z.object({
    version: z.string().min(1),
    provenance: provenanceSchema.default(ORIGINAL_PROVENANCE),
  })).default({}),
  resourceSlots: z.record(slugSchema, z.object({
    blueprint: slugSchema,
    label: z.string().min(1),
    kind: z.enum(["repo", "mcp", "environment", "folder", "deployment"]),
    required: z.boolean(),
    description: z.string(),
    resourceType: z.enum(["repo", "mcp", "environment", "folder", "deployment"]).nullable().default(null),
    resource: z.string().nullable().default(null),
  })).default({}),
  environments: z.record(slugSchema, documentEnvironmentSchema).default({}),
  secrets: z
    .record(
      slugSchema,
      z.object({
        providerRef: z.string().min(1),
        purpose: z.enum(["mcp", "repo", "env", "webhook"]),
      }),
    )
    .default({}),
  mcp: z.record(slugSchema, documentMcpSchema).default({}),
  repos: z.record(slugSchema, documentRepoSchema).default({}),
  skills: z.record(slugSchema, documentSkillSchema).default({}),
  agents: z.record(slugSchema, documentAgentSchema).default({}),
  templates: z.record(slugSchema, documentTemplateSchema).default({}),
});

export type AgentosDocument = z.infer<typeof agentosDocumentSchema>;
export type DocumentAgent = z.infer<typeof documentAgentSchema>;

/** Applying a document reports what it changed, so `push` is never silent. */
export interface PushResult {
  created: string[];
  updated: string[];
  skipped: string[];
}
