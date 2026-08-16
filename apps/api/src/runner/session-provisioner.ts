import { Injectable } from "@nestjs/common";
import { FilesService } from "../files/files.service";
import type { AgentRow } from "../agents/agents.service";
import type { TaskRow } from "../tasks/tasks.service";
import { EnvironmentPolicyResolver } from "./environment-policy";
import { ManifestResolver } from "./manifest";
import type { Runner, RunnerHandle } from "./runner.types";
import { SessionsService } from "../sessions/sessions.service";
import { buildKickoff, buildSystemPrompt, describeFolders } from "./session-prompt";
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
    private readonly files: FilesService,
    private readonly sessions: SessionsService,
  ) {}

  async provision(input: {
    /** The session row this provision belongs to, for the access record. */
    sessionId: string;
    agent: AgentRow;
    task: TaskRow | null;
    runner: Runner;
    kickoff?: string;
    budgetUsd: number | null;
    /** Set for a goal session: it also gets the goal's shared folder. */
    goalId?: string | null;
    onVaultsCreated?: (vaultIds: string[]) => Promise<void>;
  }): Promise<RunnerHandle> {
    const tools = toolsForAgent(input.agent);
    const grants = await this.manifest.resolve(input.agent);
    // Attachments are stored as ids and read as paths: the agent works in
    // paths, because that is what its filesystem tools take.
    const attachments = input.task
      ? await this.files.pathsByIds(input.task.projectId, input.task.attachmentIds)
      : [];
    // Resolved after the grants, because whether the wall permits MCP at all
    // is decided by whether this agent was granted an MCP server.
    const policy = await this.environmentPolicy.resolve(
      input.agent,
      grants.mcpServers.length > 0,
    );

    // Recorded before the run, from the same resolved grants the container
    // gets — not from the agent row, which the operator may edit tomorrow.
    await this.sessions.recordAccess(input.sessionId, {
      model: input.agent.model,
      tools: tools.map((tool) => tool.name),
      mcpServers: grants.mcpServers.map((server) => ({
        name: server.name,
        allowedOperations: server.allowedOperations,
      })),
      repos: grants.repos.map((repo) => ({
        name: repo.name,
        mountPath: repo.mountPath,
        permissions: repo.permissions,
      })),
      // Keys, never values: this ends up on a screen.
      envVarKeys: grants.envVars.map((variable) => variable.key),
      skills: grants.skills.map((skill) => skill.name),
      folders: describeFolders(input.agent, input.goalId ?? null),
      collaborators: input.agent.collaborationList,
      networking: policy.networking,
      allowedHosts: policy.allowedHosts,
    });

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
        attachments,
        goalId: input.goalId ?? null,
      }),
      kickoff: input.kickoff ?? buildKickoff(input.task, { update: TOOL_TASK_UPDATE }),
      budgetUsd: input.budgetUsd,
      onVaultsCreated: input.onVaultsCreated,
      ...grants,
    });
  }

}
