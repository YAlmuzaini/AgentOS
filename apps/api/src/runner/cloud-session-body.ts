import { BadRequestException } from "@nestjs/common";
import type { GrantedRepo, ProvisionInput } from "./runner.types";

/**
 * Repos this session can actually mount.
 *
 * A grant the runtime cannot honour is a broken configuration, and the only
 * honest moments to say so are here or never: once the session starts, the
 * agent has a manifest promising a repository that does not exist.
 */
function assertMountable(repos: GrantedRepo[]): GrantedRepo[] {
  const unusable = repos.filter((repo) => repo.token === null);
  if (unusable.length > 0) {
    throw new BadRequestException(
      `these repos are granted but have no credential, and the runtime mounts nothing without one: ` +
        `${unusable.map((repo) => repo.name).join(", ")}. Attach a secret to each, or remove the grant.`,
    );
  }
  return repos;
}

/**
 * The Managed Agents session request for one AgentOS session.
 *
 * Pure and separate so the runner reads as a lifecycle and this reads as a
 * contract with the runtime — the two change for different reasons.
 */
export function sessionBody(
  input: ProvisionInput,
  published: { environmentId: string; agentId: string; version: number; vaultIds: string[] },
): Record<string, unknown> {
  const { environmentId, agentId, version, vaultIds } = published;
  // The runtime requires a token per repository, so a repo granted without a
  // credential cannot be mounted at all. Dropping it silently was the problem:
  // the prompt still listed it, so the agent went looking for source that was
  // never there. `assertMountable` refuses the session instead.
  const mountable = assertMountable(input.repos);
  return {
      agent: { type: "agent", id: agentId, version },
      environment_id: environmentId,
      title: input.task?.name ?? `AgentOS · ${input.agent.name}`,
      metadata: {
        agentos_agent: input.agent.name,
        // Read back by the orphan sweep: without it a stray container cannot be
        // attributed to a project, and a project that turned sweeping off would
        // have its containers swept by a project that left it on.
        agentos_project: input.agent.projectId,
        ...(input.task ? { agentos_task: input.task.id } : {}),
      },
      ...(vaultIds.length > 0 ? { vault_ids: vaultIds } : {}),
      // A goal's remaining spend cap becomes a hard runtime ceiling for this
      // session, so the rail holds even if the control plane misses a beat.
      ...(input.budgetUsd !== null && input.budgetUsd > 0
        ? {
            budget: {
              type: "limit",
              max_list_cost: {
                amount: String(Math.max(1, Math.round(input.budgetUsd * 100))),
                currency: "USD",
              },
            },
          }
        : {}),
      // Only granted repos are mounted, and the token is handed to the runtime
      // proxy rather than into the container (SPEC §5.8).
      ...(mountable.length > 0
        ? {
            resources: mountable.map((repo) => ({
              type: "github_repository",
              url: repo.remoteUrl,
              mount_path: repo.mountPath,
              authorization_token: repo.token,
              checkout: { type: "branch", name: repo.branch },
            })),
          }
        : {}),
      initial_events: [{ type: "user.message", content: [{ type: "text", text: input.kickoff }] }],
    };
}
