import { z } from "zod";
import { CATEGORIES, type Category } from "../catalog/categories";
import { RUNNER_PREFERENCES, REPO_PERMISSIONS } from "../enums";
import { patchSchema } from "./patch";
import { slugSchema } from "./project";
import { mountPathSchema } from "./resources";
import { provenanceSchema, type Provenance } from "./provenance";

/**
 * Grants are default-deny (SPEC §5.1): anything absent from these arrays is
 * denied. Phase 1 stores them; Phase 2 enforces them at the runner boundary.
 */
export const repoAccessSchema = z.object({
  repoId: z.string().uuid(),
  mountPath: mountPathSchema,
  permissions: z.enum(REPO_PERMISSIONS),
});
export type RepoAccess = z.infer<typeof repoAccessSchema>;

export const filesystemGrantSchema = z.object({
  folderPath: z.string().startsWith("/"),
  canRead: z.boolean(),
  canWrite: z.boolean(),
  canDelete: z.boolean(),
  /**
   * When true this grant covers that one path and nothing under it.
   *
   * Folder grants are prefixes, which is what an operator means by granting a
   * folder. A task attachment means the opposite: this file, not the tree that
   * happens to share its name — `/private/report.md` must not also open
   * `/private/report.md/secrets`.
   */
  exact: z.boolean().optional(),
});
export type FilesystemGrant = z.infer<typeof filesystemGrantSchema>;

export const createAgentSchema = z.object({
  name: slugSchema,
  title: z.string().min(1).max(200),
  /**
   * What this agent is for and when to reach for it.
   *
   * Optional, because an operator writing a one-off agent should not be stopped
   * by a form field — but it is the text the Agents page shows under the title,
   * and the one thing that makes a library of thirty roles navigable. Capped at
   * the same 1024 characters Anthropic's Agent Skills spec puts on a skill
   * description, for the same reason: past that it stops being a summary.
   */
  description: z.string().max(1024).default(""),
  category: z.enum(CATEGORIES).default("general"),
  model: z.string().min(1),
  /** Shared AgentOS prompt. Defaults to the reconstructed contract in prompts/. */
  foundationalPrompt: z.string().optional(),
  /** The one-job contract for this role. */
  rolePrompt: z.string().min(1),
  skillIds: z.array(z.string().uuid()).default([]),
  mcpConnectionIds: z.array(z.string().uuid()).default([]),
  repoAccess: z.array(repoAccessSchema).default([]),
  filesystemGrants: z.array(filesystemGrantSchema).default([]),
  /** Agent names this agent may spawn as a subtask. Only path to spawn (SPEC §5.10). */
  collaborationList: z.array(slugSchema).default([]),
  environmentId: z.string().uuid().nullable().default(null),
  runnerPreference: z.enum(RUNNER_PREFERENCES).default("inherit"),
  inboxAccess: z.boolean().default(true),
  provenance: provenanceSchema.optional(),
});
export type CreateAgentInput = z.infer<typeof createAgentSchema>;

export const updateAgentSchema = patchSchema(createAgentSchema).omit({ name: true });
export type UpdateAgentInput = z.infer<typeof updateAgentSchema>;

export interface AgentDto {
  id: string;
  projectId: string;
  name: string;
  title: string;
  description: string;
  category: Category;
  model: string;
  foundationalPrompt: string;
  rolePrompt: string;
  skillIds: string[];
  mcpConnectionIds: string[];
  repoAccess: RepoAccess[];
  filesystemGrants: FilesystemGrant[];
  collaborationList: string[];
  environmentId: string | null;
  runnerPreference: (typeof RUNNER_PREFERENCES)[number];
  inboxAccess: boolean;
  provenance: Provenance;
  createdAt: string;
  updatedAt: string;
}
