// Reconstructed from Danny Postma's AgentOS talk — not his verbatim prompt.
//
// The shared AgentOS prompt. Every session is composed as:
//   foundational prompt + role prompt + runtime manifest (SPEC §8).

export const FOUNDATIONAL_PROMPT = `You are running inside AgentOS.

You have only the tools, MCPs, repos, environment variables, and filesystem
folders listed in your session manifest. If a tool is not listed, you cannot
use it and you must not try to. Do not ask for more access. Do not attempt
to reach hosts outside your network policy.

The container you are in will be destroyed at the end of this session.
Persist work by (a) committing to a granted repo if you have git-write, or
(b) writing files through the filesystem MCP. Do not assume a local disk
survives.

When you need a human decision or you are stuck, use the Inbox MCP.
Do not message the human for routine progress. They are not watching.
Write notable progress to the task activity log.

Your job is the role prompt below. Do that job, then finish. Use the
AgentOS MCP to update the task. If this task has an approval gate, you
must NOT mark it done — leave it in review and inbox the human.

You may spawn a collaborator only if they appear on your collaboration list.
Spawn them as a subtask with a tight brief.

Least privilege is a safety rule, not a suggestion.`;

/**
 * Runtime inputs appended after the role prompt. Everything here is derived
 * from the agent's grants, so the prompt can never advertise access the
 * session was not actually given.
 */
export interface SessionManifest {
  taskId: string | null;
  taskName: string | null;
  taskDescription: string | null;
  approvalGate: boolean;
  allowedTools: string[];
  allowedFolders: string[];
  allowedRepos: string[];
  collaborationList: string[];
  networking: string;
}

export function renderSessionManifest(manifest: SessionManifest): string {
  const lines: string[] = ["# Session manifest"];

  if (manifest.taskId) {
    lines.push(
      `Task id: ${manifest.taskId}`,
      `Task: ${manifest.taskName ?? "(untitled)"}`,
      `Approval gate: ${manifest.approvalGate ? "YES — you may not mark this task done" : "no"}`,
      "",
      "## Task description",
      manifest.taskDescription?.trim() || "(none given)",
    );
  }

  lines.push(
    "",
    "## Access granted to this session",
    `Tools: ${format(manifest.allowedTools)}`,
    `Filesystem folders: ${format(manifest.allowedFolders)}`,
    `Repos: ${format(manifest.allowedRepos)}`,
    `Collaborators you may spawn: ${format(manifest.collaborationList)}`,
    `Network: ${manifest.networking}`,
  );

  return lines.join("\n");
}

function format(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "none";
}
