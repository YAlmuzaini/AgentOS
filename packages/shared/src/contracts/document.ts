import { z } from "zod";
import { NETWORKING_MODES, REPO_PERMISSIONS, RUNNER_PREFERENCES } from "../enums";
import { mountPathSchema } from "./resources";
import { filesystemGrantSchema } from "./agent";
import { slugSchema } from "./project";
import { templateStepSchema } from "./template";

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
});

export const documentSkillSchema = z
  .object({
    name: z.string().min(1),
    kind: z.enum(["prompt", "file"]).default("prompt"),
    body: z.string().default(""),
    filePath: z.string().nullable().default(null),
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
});

export const documentMcpSchema = z.object({
  url: z.string().url(),
  allowedOperations: z.array(z.string().min(1)).default([]),
  /** Name of a secret reference, resolved by the control plane. */
  credential: slugSchema.nullable().default(null),
});

export const documentRepoSchema = z.object({
  remoteUrl: z.string().url(),
  // Shared with the REST schema on purpose: YAML is a second door into the
  // same database, and a traversal-bearing mount path is no safer for having
  // arrived through a file.
  mountPath: mountPathSchema,
  defaultBranch: z.string().min(1).default("main"),
  credential: slugSchema.nullable().default(null),
});

export const agentosDocumentSchema = z.object({
  project: slugSchema,
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
