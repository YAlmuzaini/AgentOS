import {
  agents,
  type Database,
  environments,
  mcpConnections,
  projectResourceSlots,
  repos,
  skills,
} from "@agentos/db";
import {
  type CapabilityCard,
  eligibleRoster,
  findMcpSeed,
  findRoleSeed,
  type RequiredCapabilities,
  RUNNER_CAPABILITIES,
} from "@agentos/shared";
import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DATABASE } from "../db/db.module";

@Injectable()
export class CapabilityService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * The required resources this project has actually resolved.
   *
   * Only *resolved* required slots count. An unresolved required slot is a
   * separate preflight error — treating it as a capability requirement too
   * would report the same problem twice and, worse, would make every agent
   * look incapable of a resource that does not exist yet.
   */
  async requirements(projectId: string): Promise<RequiredCapabilities> {
    const slots = await this.db
      .select()
      .from(projectResourceSlots)
      .where(eq(projectResourceSlots.projectId, projectId));
    const repoIds = new Set<string>();
    const environmentIds = new Set<string>();
    const mcpIds = new Set<string>();
    for (const slot of slots) {
      if (!slot.definition.required || !slot.resourceId || !slot.resourceType) continue;
      if (slot.resourceType === "repo") repoIds.add(slot.resourceId);
      else if (slot.resourceType === "environment") environmentIds.add(slot.resourceId);
      // A deployment slot resolves to an MCP connection row, like `mcp` does.
      else if (slot.resourceType === "mcp" || slot.resourceType === "deployment") {
        mcpIds.add(slot.resourceId);
      }
    }
    // Sets, because two blueprints can point different slot keys at the same
    // resource; a duplicate would report the same gap twice.
    return {
      repoIds: [...repoIds],
      environmentIds: [...environmentIds],
      mcpIds: [...mcpIds],
    };
  }

  /** Cards, the resolved requirements, and the bounded roster that may be dispatched. */
  async roster(
    projectId: string,
    runnerPreference: "cloud" | "local" | "auto",
  ): Promise<{ cards: CapabilityCard[]; required: RequiredCapabilities; eligible: CapabilityCard[] }> {
    const [cards, required] = await Promise.all([
      this.cards(projectId),
      this.requirements(projectId),
    ]);
    return { cards, required, eligible: eligibleRoster(cards, required, runnerPreference) };
  }

  async cards(projectId: string): Promise<CapabilityCard[]> {
    const [agentRows, skillRows, mcpRows, repoRows, environmentRows] = await Promise.all([
      this.db.select().from(agents).where(eq(agents.projectId, projectId)),
      this.db.select().from(skills).where(eq(skills.projectId, projectId)),
      this.db.select().from(mcpConnections).where(eq(mcpConnections.projectId, projectId)),
      this.db.select().from(repos).where(eq(repos.projectId, projectId)),
      this.db.select().from(environments).where(eq(environments.projectId, projectId)),
    ]);
    const skillById = new Map(skillRows.map((row) => [row.id, row]));
    const mcpById = new Map(mcpRows.map((row) => [row.id, row]));
    const repoById = new Map(repoRows.map((row) => [row.id, row]));
    const environmentById = new Map(environmentRows.map((row) => [row.id, row]));
    const agentNames = new Set(agentRows.map((row) => row.name));

    return agentRows.map((agent) => {
      const reasons: string[] = [];
      const resolvedSkills = agent.skillIds.flatMap((id) => {
        const row = skillById.get(id);
        if (!row) reasons.push(`skill ${id} is missing`);
        return row ? [row] : [];
      });
      // A *recommendation* is advice, not a grant requirement. Counting a
      // missing one as a readiness failure made the removal the installer
      // deliberately preserves — "remove one and it stays removed" — the same
      // act that made the agent ineligible for every goal and blocked every
      // workflow that dispatches to it. Advisories are reported and do not
      // affect `ready`.
      const advisories: string[] = [];
      const role = agent.builtIn ? findRoleSeed(agent.name) : undefined;
      for (const slug of role?.recommendedSkills ?? []) {
        if (!resolvedSkills.some((skill) => skill.slug === slug)) {
          advisories.push(`recommended capability ${slug} is not attached`);
        }
      }
      const resolvedRepos = agent.repoAccess.flatMap((access) => {
        const row = repoById.get(access.repoId);
        if (!row) reasons.push(`repository ${access.repoId} is missing`);
        if (row && !row.credentialSecretId && !row.githubInstallationId) {
          reasons.push(`repository ${row.name} has no credential`);
        }
        return row ? [{ row, access }] : [];
      });
      const resolvedMcp = agent.mcpConnectionIds.flatMap((id) => {
        const row = mcpById.get(id);
        if (!row) reasons.push(`MCP connection ${id} is missing`);
        const catalog = row ? findMcpSeed(row.name) : undefined;
        if (row && catalog?.credentialRequired && !row.credentialSecretId) {
          reasons.push(`MCP connection ${row.name} requires a credential`);
        }
        return row ? [row] : [];
      });
      const environment = agent.environmentId ? environmentById.get(agent.environmentId) : null;
      if (agent.environmentId && !environment) reasons.push(`environment ${agent.environmentId} is missing`);
      for (const collaborator of agent.collaborationList) {
        if (!agentNames.has(collaborator)) reasons.push(`collaborator ${collaborator} is missing`);
      }
      const localCompatible =
        (!RUNNER_CAPABILITIES.local.enforceableEgress
          ? (environment?.networking ?? "limited") === "open"
          : true) &&
        (RUNNER_CAPABILITIES.local.mcpPerToolFiltering
          ? true
          : resolvedMcp.every((connection) => connection.allowedOperations.length === 0));

      return {
        id: agent.id,
        name: agent.name,
        title: agent.title,
        description: agent.description,
        category: agent.category,
        skillSlugs: resolvedSkills.map((row) => row.slug),
        repos: resolvedRepos.map(({ row, access }) => ({
          id: row.id,
          name: row.name,
          permissions: access.permissions,
        })),
        mcp: resolvedMcp.map((row) => ({
          id: row.id,
          name: row.name,
          configured: !findMcpSeed(row.name)?.credentialRequired || Boolean(row.credentialSecretId),
          verified: Boolean(row.verifiedAt),
          allowedOperations: row.allowedOperations,
        })),
        environment: environment
          ? {
              id: environment.id,
              name: environment.name,
              networking: environment.networking,
              allowedHosts: environment.allowedHosts,
            }
          : null,
        runnerPreference: agent.runnerPreference,
        runnerCompatibility: localCompatible ? ["cloud", "local"] : ["cloud"],
        collaborators: agent.collaborationList,
        ready: reasons.length === 0,
        reasons,
        advisories,
      } satisfies CapabilityCard;
    });
  }
}
