/**
 * The wire contract with `apps/api/src/runner/local-runner.ts`.
 *
 * These types are duplicated rather than imported from the control plane on
 * purpose: this worker is a separate deployable that runs on the operator's own
 * machine, and it must not need — or be able to reach — anything from the
 * AgentOS package tree. The duplication is the boundary.
 */

export interface CustomToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ProvisionBody {
  agent: string;
  model: string;
  systemPrompt: string;
  kickoff: string;
  tools: CustomToolDefinition[];
  environment: { key: string; networking: "open" | "limited"; allowedHosts: string[] };
  repos: Array<{
    name: string;
    remoteUrl: string;
    mountPath: string;
    branch: string;
    permissions: "git-read" | "git-write";
    token: string | null;
  }>;
  mcpServers: Array<{
    name: string;
    url: string;
    allowedOperations: string[];
    token: string | null;
  }>;
  envVars: Array<{ key: string; value: string; allowedHosts: string[] }>;
  budgetUsd: number | null;
}

/** One repository's outcome from the publish step. */
export interface PublishRecord {
  repo: string;
  branch: string;
  pushed: boolean;
  remoteSha: string | null;
  commits: number;
  error: string | null;
}

export interface PublishResponse {
  records: PublishRecord[];
  /**
   * Set when a push failed and the worker kept the workspace rather than
   * deleting the only copy of the work. An operator path, not an automatic one.
   */
  retainedWorkspace: string | null;
}

export type RunnerEvent =
  | { kind: "log"; type: string; name: string | null; summary: string; eventId: string | null }
  | {
      kind: "tool-call";
      call: { toolUseId: string; name: string; input: Record<string, unknown> };
      eventId: string | null;
    }
  | { kind: "idle"; stopReason: string }
  | { kind: "terminated" }
  | { kind: "error"; message: string };

/** One SSE frame, in the shape the control plane's reader expects. */
export function frame(event: RunnerEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}
