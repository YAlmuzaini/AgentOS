import { attachmentGrants, goalFolderGrant } from "@agentos/shared";
import type { AgentRow } from "../agents/agents.service";
import type { ToolContext } from "./tool-handler";

/**
 * What the control plane knows about a session while answering its tool calls.
 *
 * Built here rather than in either orchestrator so a session that is resumed
 * gets exactly the context it started with. The grants travel on it: the tool
 * handler authorises against these fields and nothing else, so a context built
 * two different ways is two different security decisions.
 */
export function toolContext(
  sessionId: string,
  projectId: string,
  agent: AgentRow,
  taskId: string | null,
  goalId: string | null,
  /** Paths of the task's attachments, which this session may read. */
  attachmentPaths: string[] = [],
): ToolContext {
  return {
    sessionId,
    projectId,
    agentId: agent.id,
    agentSlug: agent.name,
    taskId,
    goalId,
    inboxAccess: agent.inboxAccess,
    // The goal's shared folder is a grant of the *session*, not of the agent:
    // the same specialist working a different goal must not reach this one's
    // files (SPEC §11 shared state).
    filesystemGrants: [
      ...agent.filesystemGrants,
      ...goalFolderGrant(goalId),
      ...attachmentGrants(attachmentPaths),
    ],
    collaborationList: agent.collaborationList,
    // Only an agent that may push has commits to record. Same grant, read the
    // same way the tool list reads it.
    writableRepoIds: agent.repoAccess
      .filter((access) => access.permissions === "git-write")
      .map((access) => access.repoId),
  };
}
