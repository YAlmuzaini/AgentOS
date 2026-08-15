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
): ToolContext {
  return {
    sessionId,
    projectId,
    agentId: agent.id,
    agentSlug: agent.name,
    taskId,
    goalId,
    inboxAccess: agent.inboxAccess,
    filesystemGrants: agent.filesystemGrants,
  };
}
