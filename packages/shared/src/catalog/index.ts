/**
 * The catalogue AgentOS ships: roles, skills, and MCP connections.
 *
 * This is the answer to "a new project starts empty and I have to retype
 * everything". Installing the catalogue writes inert rows — an agent with no
 * grants, a skill attached to nobody, a connection nobody may call — so a new
 * project arrives with a *library to pick from* rather than with access to
 * anything (SPEC §5.1, default deny).
 *
 * Roles are split across four files only because they belong to different
 * jobs, not different mechanisms: `roles-core` holds the fourteen SPEC §4
 * names the built-in templates dispatch to, and the specialist files hold
 * everything the templates do not require.
 */

import { FOUNDATIONAL_PROMPT } from "../prompts/foundational";
import { BUILT_IN_MCP, MCP_CATALOG } from "./mcp";
import { CORE_ROLE_SEEDS } from "./roles-core";
import { DATA_ROLE_SEEDS } from "./roles-data";
import { PRODUCT_ROLE_SEEDS } from "./roles-product";
import { SPECIALIST_ROLE_SEEDS } from "./roles-specialists";
import { CRAFT_SKILL_SEEDS } from "./skills-craft";
import { RAG_SKILL_SEEDS } from "./skills-rag";
import { PROCESS_SKILL_SEEDS } from "./skills-process";
import type { McpSeed, RoleSeed, SkillSeed } from "./types";
import { originalAgentosProvenance, type Provenance } from "../contracts/provenance";

export * from "./categories";
export * from "./types";
export * from "./mcp";
export * from "./packs";
export * from "./blueprints";

/**
 * Every role AgentOS ships, core first.
 *
 * Order matters to the reader, not to the code: a list that opens with the
 * fourteen roles the templates actually dispatch to is easier to trust than an
 * alphabetical one where `content-writer` comes before `default`.
 */
export const ROLE_SEEDS: RoleSeed[] = [
  ...CORE_ROLE_SEEDS,
  ...SPECIALIST_ROLE_SEEDS,
  ...DATA_ROLE_SEEDS,
  ...PRODUCT_ROLE_SEEDS,
];

/** Every skill AgentOS ships. Unique per project by slug. */
export const BUILT_IN_SKILLS: SkillSeed[] = [
  ...PROCESS_SKILL_SEEDS,
  ...CRAFT_SKILL_SEEDS,
  ...RAG_SKILL_SEEDS,
];

export const DEFAULT_ROLE_NAME = "default";

export function findRoleSeed(name: string): RoleSeed | undefined {
  return ROLE_SEEDS.find((role) => role.name === name);
}

export function findSkillSeed(slug: string): SkillSeed | undefined {
  return BUILT_IN_SKILLS.find((skill) => skill.slug === slug);
}

/** Looks across the whole catalogue, not just the default-installed part. */
export function findMcpSeed(slug: string): McpSeed | undefined {
  return MCP_CATALOG.find((entry) => entry.slug === slug);
}

/**
 * The model a role runs on.
 *
 * Two tiers, chosen by whether the role's output is a judgement or a
 * transcription of one. Held here rather than on each seed so that adding a
 * role does not require an opinion about pricing, and so the two ids appear
 * once when a third model family is added later.
 */
const PLANNER_MODEL = "claude-opus-5";
const WORKER_MODEL = "claude-sonnet-5";

export interface RoleInstall {
  name: string;
  title: string;
  description: string;
  category: string;
  /** Slugs, resolved to ids by the installer against what the project has. */
  recommendedSkills: string[];
  model: string;
  foundationalPrompt: string;
  rolePrompt: string;
  collaborationList: string[];
  /**
   * Always `inherit`: where an agent runs is the operator's judgement and their
   * money, so installing built-ins must never quietly move it.
   */
  runnerPreference: "inherit";
  inboxAccess: boolean;
  provenance: Provenance;
}

/**
 * How a built-in role is installed into a project.
 *
 * This lived in `packages/db/src/seed.ts`, where only `pnpm db:seed` could
 * reach it — so a project created any other way had no agents and no way to get
 * them without retyping fourteen prompts. It moved here so the seed and the
 * "install built-ins" endpoint install the *same* agents; two copies of this
 * knowledge would have drifted the first time a prompt was improved.
 */
export function builtInRoleInstalls(): RoleInstall[] {
  return ROLE_SEEDS.map((role) => ({
    name: role.name,
    title: role.title,
    description: role.description,
    category: role.category,
    model: role.planner ? PLANNER_MODEL : WORKER_MODEL,
    foundationalPrompt: FOUNDATIONAL_PROMPT,
    rolePrompt: role.rolePrompt,
    // Absent means spawns nobody, which is the default and the safe one.
    collaborationList: role.collaboration ?? [],
    recommendedSkills: role.recommendedSkills ?? [],
    runnerPreference: "inherit" as const,
    inboxAccess: true,
    provenance:
      role.provenance ??
      originalAgentosProvenance("Original AgentOS role prompt reconstructed under SPEC.md."),
  }));
}

export function skillProvenance(skill: SkillSeed): Provenance {
  return skill.provenance ?? originalAgentosProvenance("Original AgentOS inline prompt skill.");
}

export function mcpProvenance(entry: McpSeed): Provenance {
  return (
    entry.provenance ??
    originalAgentosProvenance(
      "Original AgentOS connection metadata based on the vendor's canonical documentation; the vendor did not author AgentOS copy.",
    )
  );
}
