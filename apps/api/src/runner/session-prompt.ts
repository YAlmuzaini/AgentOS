import { agentHomeFolder, goalFolderGrant, renderSessionManifest } from "@agentos/shared";
import type { AgentRow } from "../agents/agents.service";
import type { TaskRow } from "../tasks/tasks.service";
import type { ResolvedGrants } from "./manifest";
import type { CustomToolDefinition, EnvironmentPolicy } from "./runner.types";
import { type HandoffDto, renderHandoffContext } from "@agentos/shared";

/**
 * Composes the session prompt exactly as SPEC §8 describes:
 * foundational prompt + role prompt + runtime manifest.
 *
 * The manifest is rendered from the *resolved* grants rather than from what
 * the agent config asks for, so it can never advertise access the session was
 * not actually given.
 */
export function buildSystemPrompt(input: {
  agent: AgentRow;
  task: TaskRow | null;
  tools: CustomToolDefinition[];
  environment: EnvironmentPolicy;
  grants: ResolvedGrants;
  /** Filesystem paths for the task's attachments, already resolved. */
  attachments?: string[];
  /** Set for a goal session: it also holds the goal's shared folder. */
  goalId?: string | null;
}): string {
  const manifest = renderSessionManifest({
    taskId: input.task?.id ?? null,
    taskName: input.task?.name ?? null,
    taskDescription: input.task?.description ?? null,
    approvalGate: input.task?.approvalGate ?? false,
    attachments: input.attachments ?? [],
    allowedTools: [
      "the standard agent toolset (bash, file read/write/edit, glob, grep, web)",
      ...input.tools.map((tool) => tool.name),
      ...input.grants.mcpServers.map((server) =>
        server.allowedOperations.length > 0
          ? `${server.name} (MCP: ${server.allowedOperations.join(", ")})`
          : `${server.name} (MCP)`,
      ),
    ],
    allowedFolders: describeFolders(input.agent, input.goalId ?? null),
    allowedRepos: input.grants.repos.map(
      (repo) => `${repo.mountPath} → ${repo.name} (${repo.permissions})`,
    ),
    collaborationList: input.agent.collaborationList,
    networking:
      input.environment.networking === "open"
        ? "unrestricted egress"
        : `restricted — only ${input.environment.allowedHosts.join(", ") || "nothing"} is reachable`,
  });

  // A file skill has no body — its content is on the agent filesystem, so the
  // prompt gives the path and lets the agent read it with the tools it already
  // has. Rendering it like a prompt skill printed an empty section.
  const skills = input.grants.skills
    .map((skill) =>
      skill.kind === "file"
        ? `## Skill: ${skill.name}\nRead ${skill.filePath ?? "(no path recorded)"} when you need it.`
        : `## Skill: ${skill.name}\n${skill.body}`,
    )
    .join("\n\n");
  // Handoffs are deliberately absent here. They are agent-authored text, and
  // the system prompt is the one layer in a session that the operator alone
  // controls — putting untrusted prose at that priority is the whole of the
  // prompt-injection problem. They travel on the first *user* turn instead;
  // see `buildKickoff`.
  return [
    input.agent.foundationalPrompt,
    "",
    "# Your role",
    input.agent.rolePrompt,
    "",
    manifest,
    skills ? `\n# Skills\n\n${skills}` : "",
  ].join("\n");
}

export function describeFolders(agent: AgentRow, goalId: string | null): string[] {
  // A name that cannot form a home folder gets no home line: the prompt must
  // not promise access the ACL will refuse.
  const homeFolder = agentHomeFolder(agent.name);
  const home = homeFolder ? `${homeFolder} (read/write — your own folder)` : null;
  const shared = goalFolderGrant(goalId).map(
    (grant) =>
      `${grant.folderPath} (read/write — shared with every specialist on this goal; leave what the next one needs here)`,
  );
  const explicit = agent.filesystemGrants.map((grant) => {
    const verbs = [
      grant.canRead ? "read" : null,
      grant.canWrite ? "write" : null,
      grant.canDelete ? "delete" : null,
    ].filter(Boolean);
    return `${grant.folderPath} (${verbs.join("/") || "no access"})`;
  });
  return [...(home ? [home] : []), ...shared, ...explicit];
}

/**
 * The first user turn. Starts the run; the manifest already carries context.
 *
 * Prior handoffs are appended here rather than to the system prompt: they are
 * written by other agents, and this is the layer that already holds every
 * other piece of agent-authored text a session reads.
 */
export function buildKickoff(
  task: TaskRow | null,
  toolNames: { update: string },
  handoffs: readonly HandoffDto[] = [],
): string {
  const base = task
    ? [
        `Work the task "${task.name}".`,
        "",
        task.description.trim() || "(no description was given — use the task name.)",
        "",
        `Call ${toolNames.update} with status "doing" when you start, and again when the work reaches its end state.`,
      ].join("\n")
    : "Begin. Follow your role prompt and finish.";
  return `${base}${renderHandoffContext(handoffs)}`;
}

/** Appends the same bounded untrusted block to a brief the orchestrator wrote. */
export function withHandoffContext(kickoff: string, handoffs: readonly HandoffDto[]): string {
  return `${kickoff}${renderHandoffContext(handoffs)}`;
}
