import { createHash } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import type {
  ManagedAgentsApi,
  MaNetworkingLimited,
  MaNetworkingUnrestricted,
} from "./managed-agents.api";
import type { EnvironmentPolicy, ProvisionInput } from "./runner.types";

const AGENT_TOOLSET = "agent_toolset_20260401";

/**
 * A runtime environment's name, derived from everything that makes it a
 * different wall: the project it belongs to and the policy itself.
 */
function environmentName(policy: EnvironmentPolicy): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        networking: policy.networking,
        allowMcpServers: policy.allowMcpServers,
        // Order must not change identity: the same hosts listed differently are
        // the same wall.
        allowedHosts: [...policy.allowedHosts].sort(),
      }),
    )
    .digest("hex")
    .slice(0, 10);
  // The whole project id, not a prefix: eight hex characters collide far more
  // often than intuition suggests, and a collision here means two projects
  // sharing one network wall.
  return `agentos-${policy.projectId}-${policy.key}-${digest}`;
}

/**
 * Publishes AgentOS state into the runtime's own persistent objects.
 *
 * Managed Agents keeps environments, agents and vaults as long-lived,
 * versioned resources; AgentOS keeps the same things in its database. This is
 * the one place that reconciles the two, so the runner itself only has to
 * think about a single session.
 */
@Injectable()
export class CloudPublisher {
  private readonly logger = new Logger(CloudPublisher.name);
  private readonly environmentCache = new Map<string, string>();

  /**
   * One runtime environment per *policy*, reused across sessions.
   *
   * The name carries the project and a digest of the policy itself, not just
   * the operator's name for it. Two projects both calling an environment
   * `production` are two different walls, and editing an environment's
   * allowlist has to publish a new one rather than keep handing sessions the
   * old, wider environment under the same name. Naming it after the contents is
   * what makes both true.
   */
  async ensureEnvironment(api: ManagedAgentsApi, policy: EnvironmentPolicy): Promise<string> {
    const name = environmentName(policy);
    const cached = this.environmentCache.get(name);
    if (cached) {
      return cached;
    }

    for await (const environment of api.environments.list()) {
      if (environment.name === name) {
        this.environmentCache.set(name, environment.id);
        return environment.id;
      }
    }

    const networking: MaNetworkingUnrestricted | MaNetworkingLimited =
      policy.networking === "open"
        ? { type: "unrestricted" }
        : {
            type: "limited",
            allow_package_managers: false,
            // A granted MCP server is a wall the operator opened deliberately.
            // Leaving this false made every limited environment advertise MCP
            // tools the environment then refused to let through.
            allow_mcp_servers: policy.allowMcpServers,
            allowed_hosts: policy.allowedHosts,
          };

    const created = await api.environments.create({
      name,
      config: { type: "cloud", networking },
    });
    this.environmentCache.set(name, created.id);
    return created.id;
  }

  /**
   * Runtime agents are persistent and versioned: created once, then updated in
   * place when the AgentOS-side config changes. A config hash in metadata is
   * what tells the two apart.
   */
  async ensureAgent(
    api: ManagedAgentsApi,
    input: ProvisionInput,
  ): Promise<{ agentId: string; version: number }> {
    // Same reasoning as the environment name: a truncated project id lets two
    // projects share one persistent runtime agent and race on its versions.
    const name = `agentos-${input.agent.projectId}-${input.agent.name}`;
    const tools = [
      { type: AGENT_TOOLSET },
      ...input.tools.map((tool) => ({
        type: "custom",
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema,
      })),
      // One toolset entry per granted MCP server. A server the agent was not
      // granted has no entry, so its tools do not exist for this session.
      ...input.mcpServers.map((server) => ({
        type: "mcp_toolset",
        mcp_server_name: server.name,
        ...(server.allowedOperations.length > 0
          ? {
              default_config: { enabled: false },
              configs: server.allowedOperations.map((operation) => ({
                name: operation,
                enabled: true,
              })),
            }
          : {}),
      })),
    ];
    const mcpServers = input.mcpServers.map((server) => ({
      type: "url",
      name: server.name,
      url: server.url,
    }));
    const hash = configHash({
      model: input.agent.model,
      system: input.systemPrompt,
      tools,
      mcpServers,
    });

    let existing: { id: string; version: number; hash: string | undefined } | null = null;
    for await (const candidate of api.agents.list()) {
      if (candidate.name === name) {
        existing = {
          id: candidate.id,
          version: candidate.version,
          hash: candidate.metadata?.config_hash,
        };
        break;
      }
    }

    const body = {
      name,
      model: input.agent.model,
      system: input.systemPrompt,
      tools,
      ...(mcpServers.length > 0 ? { mcp_servers: mcpServers } : {}),
      metadata: {
        agentos_agent_id: input.agent.id,
        agentos_project_id: input.agent.projectId,
        config_hash: hash,
      },
    };

    if (!existing) {
      const created = await api.agents.create(body);
      return { agentId: created.id, version: created.version };
    }
    if (existing.hash === hash) {
      return { agentId: existing.id, version: existing.version };
    }

    const updated = await api.agents.update(existing.id, { ...body, version: existing.version });
    return { agentId: updated.id, version: updated.version };
  }

  /**
   * Publishes the session's credentials into a runtime vault.
   *
   * Vault-held credentials are substituted into outbound requests at the
   * runtime's egress: the container sees an opaque placeholder, never the
   * secret, so a prompt leak cannot exfiltrate it (SPEC §5.8, §5.11).
   */
  async ensureVault(api: ManagedAgentsApi, input: ProvisionInput): Promise<string[]> {
    const mcpCredentials = input.mcpServers.filter((server) => server.token !== null);
    if (mcpCredentials.length === 0 && input.envVars.length === 0) {
      return [];
    }

    const vault = await api.vaults.create({
      display_name: `agentos-${input.agent.name}-${input.agent.id.slice(0, 8)}`,
      metadata: { agentos_agent_id: input.agent.id },
    });

    try {
      // Ownership is recorded the moment the vault exists, before anything is
      // written into it. Recording it only on the way out meant a build that
      // failed *and* whose compensating delete also failed left a vault holding
      // real credentials that no row, no handle and no sweep had ever heard of
      // — the one state from which nothing can ever retry.
      //
      // Inside the guard, because recording is itself a database call that can
      // fail: outside it, a failure there left the vault behind with no row and
      // no compensating delete either.
      await input.onVaultsCreated?.([vault.id]);
      await this.fillVault(api, vault.id, input, mcpCredentials);
    } catch (error) {
      await api.vaults.delete(vault.id).catch((cleanupError: unknown) => {
        // The session row now carries this id, so maintenance will retry the
        // delete. Still logged: a credential outliving its session is exactly
        // the thing worth seeing twice.
        this.logger.error(
          `vault ${vault.id} was left behind after a failed build; the session row will retry it: ` +
            String(cleanupError),
        );
      });
      throw error;
    }

    return [vault.id];
  }

  private async fillVault(
    api: ManagedAgentsApi,
    vaultId: string,
    input: ProvisionInput,
    mcpCredentials: ProvisionInput["mcpServers"],
  ): Promise<void> {
    for (const server of mcpCredentials) {
      await api.vaults.credentials.create(vaultId, {
        display_name: `mcp:${server.name}`,
        auth: { type: "static_bearer", mcp_server_url: server.url, token: server.token },
      });
    }

    for (const variable of input.envVars) {
      await api.vaults.credentials.create(vaultId, {
        display_name: `env:${variable.key}`,
        auth: {
          type: "environment_variable",
          secret_name: variable.key,
          secret_value: variable.value,
          networking:
            variable.allowedHosts.length > 0
              ? { type: "limited", allowed_hosts: variable.allowedHosts }
              : { type: "unrestricted" },
        },
      });
    }
  }
}

function configHash(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 32);
}
