import { type Database, environments } from "@agentos/db";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import type { AgentRow } from "../agents/agents.service";
import { DATABASE } from "../db/db.module";
import type { EnvironmentPolicy } from "./runner.types";

/** Fallback policy when an agent names no environment: deny everything. */
const DENY_ALL_KEY = "limited-none";

export function denyAll(projectId: string, allowMcpServers = false): EnvironmentPolicy {
  return {
    projectId,
    key: DENY_ALL_KEY,
    networking: "limited",
    allowedHosts: [],
    allowMcpServers,
  };
}

/**
 * Resolves the network wall a session runs behind (SPEC §5.4).
 *
 * Every failure to resolve lands on `DENY_ALL`: an agent whose environment was
 * deleted, or which names none, gets no egress rather than open egress.
 */
@Injectable()
export class EnvironmentPolicyResolver {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * @param allowMcpServers whether this session was granted any MCP server.
   * The wall has to permit MCP for a granted server to work at all, so the
   * grant — not a separate setting — is what opens it.
   */
  async resolve(agent: AgentRow, allowMcpServers = false): Promise<EnvironmentPolicy> {
    const row = agent.environmentId
      ? await this.db.query.environments.findFirst({
          // Scoped to the agent's project as well as its id: an environment is
          // a network policy, and one must never be borrowed across projects.
          where: and(
            eq(environments.projectId, agent.projectId),
            eq(environments.id, agent.environmentId),
          ),
        })
      : await this.db.query.environments.findFirst({
          where: and(
            eq(environments.projectId, agent.projectId),
            eq(environments.name, DENY_ALL_KEY),
          ),
        });

    if (!row) {
      return denyAll(agent.projectId, allowMcpServers);
    }
    return {
      projectId: agent.projectId,
      key: row.name,
      networking: row.networking,
      allowedHosts: row.allowedHosts,
      allowMcpServers,
    };
  }
}
