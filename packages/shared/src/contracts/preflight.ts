import { z } from "zod";

export const runPreflightSchema = z.object({
  subjectType: z.enum(["project", "template", "goal"]).default("project"),
  subjectId: z.string().uuid().nullable().default(null),
  inputs: z.record(z.string(), z.string()).default({}),
});
export type RunPreflightInput = z.infer<typeof runPreflightSchema>;

export type PreflightSeverity = "error" | "warning" | "info";

export interface PreflightFinding {
  code: string;
  severity: PreflightSeverity;
  message: string;
  subjectType: string;
  subjectId: string | null;
  action: string | null;
}

export interface CapabilityCard {
  id: string;
  name: string;
  title: string;
  description: string;
  category: string;
  skillSlugs: string[];
  repos: Array<{ id: string; name: string; permissions: "git-read" | "git-write" }>;
  mcp: Array<{
    id: string;
    name: string;
    configured: boolean;
    verified: boolean;
    allowedOperations: string[];
  }>;
  /** Identity is carried, not just posture: "does this agent hold *the* required
   * environment" cannot be answered from `networking` alone. */
  environment: {
    id: string;
    name: string;
    networking: "open" | "limited";
    allowedHosts: string[];
  } | null;
  runnerPreference: "cloud" | "local" | "inherit";
  runnerCompatibility: Array<"cloud" | "local">;
  collaborators: string[];
  ready: boolean;
  /** Why this agent cannot run. Non-empty means `ready` is false. */
  reasons: string[];
  /** Worth saying, but not blocking — a recommended skill the operator removed. */
  advisories: string[];
}

/**
 * The resolved resource slots a project actually requires, as ids.
 *
 * This is the single definition of "required" shared by preflight, the goal
 * evaluator's eligible roster, and the server-side selection check. An earlier
 * revision derived it twice and the two disagreed: preflight demanded every
 * installed agent hold every required resource, while the evaluator demanded
 * nothing at all, so a support agent with no repository grant could be
 * dispatched onto a repository goal.
 */
export interface RequiredCapabilities {
  repoIds: string[];
  environmentIds: string[];
  mcpIds: string[];
}

export const NO_REQUIRED_CAPABILITIES: RequiredCapabilities = {
  repoIds: [],
  environmentIds: [],
  mcpIds: [],
};

/**
 * Which required resources this agent does *not* hold. Empty means capable.
 *
 * Least privilege is the point: an agent is capable when it holds the required
 * resources, not when every agent in the project holds them.
 */
export function missingCapabilities(
  card: CapabilityCard,
  required: RequiredCapabilities,
): RequiredCapabilities {
  const heldRepos = new Set(card.repos.map((repo) => repo.id));
  const heldMcp = new Set(card.mcp.map((connection) => connection.id));
  return {
    repoIds: required.repoIds.filter((id) => !heldRepos.has(id)),
    environmentIds: required.environmentIds.filter((id) => card.environment?.id !== id),
    mcpIds: required.mcpIds.filter((id) => !heldMcp.has(id)),
  };
}

export function isCapable(card: CapabilityCard, required: RequiredCapabilities): boolean {
  const missing = missingCapabilities(card, required);
  return (
    missing.repoIds.length === 0 &&
    missing.environmentIds.length === 0 &&
    missing.mcpIds.length === 0
  );
}

/**
 * The roster a goal may actually dispatch: ready, capable of the required
 * resources, and runnable under the goal's execution profile.
 *
 * Bounded here, once, so the prompt, the audit row and the server-side
 * selection check all see the identical list.
 */
export function eligibleRoster(
  cards: readonly CapabilityCard[],
  required: RequiredCapabilities,
  runnerPreference: "cloud" | "local" | "auto",
): CapabilityCard[] {
  return cards
    .filter(
      (card) =>
        card.ready &&
        isCapable(card, required) &&
        (runnerPreference !== "local" || card.runnerCompatibility.includes("local")),
    )
    .slice(0, MAX_ELIGIBLE_AGENTS);
}

/** The evaluator prompt, the audit row and the selection check share this bound. */
export const MAX_ELIGIBLE_AGENTS = 40;

export interface PreflightReport {
  projectId: string;
  subjectType: "project" | "template" | "goal";
  subjectId: string | null;
  runnerPreference: "cloud" | "local" | "auto";
  ready: boolean;
  requiresAcknowledgement: boolean;
  findings: PreflightFinding[];
  roster: CapabilityCard[];
  checkedAt: string;
}
