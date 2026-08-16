import type { FilesystemGrant } from "@agentos/shared";

/**
 * What the control plane knows about a session while answering its tool calls,
 * and the two shapes an answer can take.
 *
 * Separate from the handler so the handlers can be split by subject without
 * importing each other: every one of them authorises against this context and
 * nothing else.
 */
export interface ToolContext {
  sessionId: string;
  projectId: string;
  agentId: string;
  agentSlug: string;
  taskId: string | null;
  goalId: string | null;
  /** Grants — an ungranted tool is refused even if the container calls it. */
  inboxAccess: boolean;
  filesystemGrants: FilesystemGrant[];
  /** Agent names this session may spawn. Empty means it may spawn nobody. */
  collaborationList: string[];
  /**
   * Repository ids this agent holds `git-write` on. A commit is recorded
   * against one of these or not at all — an attested sha with a repo name
   * nobody granted is a claim about someone else's repository.
   */
  writableRepoIds: string[];
}

export type ToolOutcome =
  | { kind: "result"; text: string }
  /** The run stops here until the operator answers; nothing is injected. */
  | { kind: "park"; inboxMessageId: string; text: null };

/** A refusal the agent reads as text, so it adapts instead of crashing. */
export function deny(reason: string): ToolOutcome {
  return { kind: "result", text: `refused: ${reason}` };
}
