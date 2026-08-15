import { Injectable } from "@nestjs/common";
import type { AgentRow } from "../agents/agents.service";
import type { TaskRow } from "../tasks/tasks.service";
import { EnvironmentPolicyResolver } from "./environment-policy";
import { ManifestResolver } from "./manifest";
import type { Runner, RunnerHandle } from "./runner.types";
import { buildKickoff, buildSystemPrompt } from "./session-prompt";
import { TOOL_TASK_UPDATE, toolsForAgent } from "./tools";

/**
 * Turns an agent into a provisioned session.
 *
 * Everything a container is allowed to touch is decided here and nowhere else:
 * the network policy, the tool list, and the resolved grants. Secret values
 * exist only inside this call — they are handed to the runner and never
 * persisted or logged.
 */
@Injectable()
export class SessionProvisioner {
  constructor(
    private readonly manifest: ManifestResolver,
    private readonly environmentPolicy: EnvironmentPolicyResolver,
  ) {}

  async provision(input: {
    agent: AgentRow;
    task: TaskRow | null;
    runner: Runner;
    kickoff?: string;
    budgetUsd: number | null;
    onVaultsCreated?: (vaultIds: string[]) => Promise<void>;
  }): Promise<RunnerHandle> {
    const tools = toolsForAgent(input.agent);
    const grants = await this.manifest.resolve(input.agent);
    // Resolved after the grants, because whether the wall permits MCP at all
    // is decided by whether this agent was granted an MCP server.
    const policy = await this.environmentPolicy.resolve(
      input.agent,
      grants.mcpServers.length > 0,
    );

    return input.runner.provision({
      agent: input.agent,
      task: input.task,
      tools,
      environment: policy,
      systemPrompt: buildSystemPrompt({
        agent: input.agent,
        task: input.task,
        tools,
        environment: policy,
        grants,
      }),
      kickoff: input.kickoff ?? buildKickoff(input.task, { update: TOOL_TASK_UPDATE }),
      budgetUsd: input.budgetUsd,
      onVaultsCreated: input.onVaultsCreated,
      ...grants,
    });
  }

}
