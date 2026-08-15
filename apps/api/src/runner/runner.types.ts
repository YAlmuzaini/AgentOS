import type { AgentRow } from "../agents/agents.service";
import type { TaskRow } from "../tasks/tasks.service";

/**
 * The Runner interface from SPEC §16. Two backends are planned:
 * `CloudManagedAgentsRunner` (Phase 1) and `LocalVmRunner` (Phase 7). The
 * control plane only ever talks to this shape.
 */
export interface RunnerHandle {
  /** Runtime session id, e.g. a Managed Agents `sesn_...`. */
  runtimeSessionId: string;
  /** Operator-visible trace URL, when the backend exposes one. */
  traceUrl: string | null;
  /**
   * Runtime objects minted for this session that destroy must also remove.
   * Vaults hold resolved secret values; archiving the session does not delete
   * them, so leaving them behind would strand credentials at the provider.
   */
  vaultIds?: string[];
}

export interface ProvisionInput {
  agent: AgentRow;
  task: TaskRow | null;
  /** Rendered foundational + role + manifest prompt. */
  systemPrompt: string;
  /** First message that starts the run. */
  kickoff: string;
  /** Custom tools the control plane will answer on this session's behalf. */
  tools: CustomToolDefinition[];
  /** Network policy for the container. */
  environment: EnvironmentPolicy;
  /**
   * Hard spend ceiling for this one session, in USD. The runtime enforces it
   * as well as the control plane, so a runaway loop is capped in two places.
   */
  budgetUsd: number | null;
  /**
   * Resolved grants. Everything here was explicitly listed on the agent; an
   * absent entry is an absent capability, not a default.
   *
   * Secret values live only in this object, in memory, for the length of one
   * provision call. They are never persisted or logged.
   */
  mcpServers: GrantedMcpServer[];
  repos: GrantedRepo[];
  envVars: GrantedEnvVar[];
  skills: GrantedSkill[];
  /**
   * Called once the backend has minted credential holders, before it creates
   * anything that could fail. Lets the control plane record ownership while
   * there is still something to record it against.
   */
  onVaultsCreated?: (vaultIds: string[]) => Promise<void>;
}

export interface GrantedMcpServer {
  name: string;
  url: string;
  /** Empty means every tool the server exposes. */
  allowedOperations: string[];
  /** Bearer credential, when the connection has one that resolved. */
  token: string | null;
}

export interface GrantedRepo {
  name: string;
  remoteUrl: string;
  mountPath: string;
  branch: string;
  permissions: "git-read" | "git-write";
  token: string | null;
}

export interface GrantedEnvVar {
  key: string;
  value: string;
  /** Hosts the value may be substituted into at egress; empty means any. */
  allowedHosts: string[];
}

export interface GrantedSkill {
  slug: string;
  name: string;
  kind: "prompt" | "file";
  /** Empty for a file skill: its content lives on the agent filesystem. */
  body: string;
  /** Set for a file skill — the path the session reads it from. */
  filePath: string | null;
}

export interface EnvironmentPolicy {
  /**
   * Owning project. Part of the runtime environment's identity: two projects
   * may each have an environment named `production` with different walls, and
   * they must never resolve to the same runtime object.
   */
  projectId: string;
  /** Stable key so the backend can cache/reuse a provisioned environment. */
  key: string;
  networking: "open" | "limited";
  allowedHosts: string[];
  /**
   * Whether the runtime may reach MCP servers at all. Derived from the
   * session's own grants rather than configured: an agent with no MCP grant
   * gets a wall that forbids MCP outright, and one with a grant gets a wall
   * that permits exactly the servers it was given.
   */
  allowMcpServers: boolean;
}

export interface CustomToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** A tool call the container made that the control plane must answer. */
export interface RunnerToolCall {
  /** Runtime id to reply to. */
  toolUseId: string;
  name: string;
  input: Record<string, unknown>;
}

export type RunnerEvent =
  | { kind: "log"; type: string; name: string | null; summary: string; eventId: string | null }
  | { kind: "tool-call"; call: RunnerToolCall; eventId: string | null }
  | { kind: "idle"; stopReason: string }
  | { kind: "terminated" }
  | { kind: "error"; message: string };

export interface Runner {
  readonly name: "cloud" | "local";
  provision(input: ProvisionInput): Promise<RunnerHandle>;
  /**
   * Consume runtime events until the session goes idle or terminates.
   *
   * `signal` must reach the underlying connection. Cancellation cannot be done
   * by the caller abandoning the iterator: `return()` on an async generator
   * blocked inside `next()` queues behind that read rather than interrupting
   * it, so a silent session — the only kind a deadline exists for — would hang
   * the consumer and leak its container.
   */
  streamEvents(
    handle: RunnerHandle,
    seenEventIds: Set<string>,
    signal?: AbortSignal,
  ): AsyncIterable<RunnerEvent>;
  /** Answer a parked tool call — this is what resumes a waiting session. */
  injectToolResult(handle: RunnerHandle, toolUseId: string, result: string): Promise<void>;
  /** Best-effort spend readout, in USD. */
  readCost(handle: RunnerHandle): Promise<number | null>;
  /** Ends the run and frees the container. */
  destroy(handle: RunnerHandle): Promise<void>;
  /**
   * Containers this backend currently has running.
   *
   * Optional because it is a reconciliation capability, not part of running a
   * session: a backend that cannot enumerate its own containers simply is not
   * swept. Used to find containers AgentOS lost track of.
   */
  listRuntimeSessions?(): Promise<RuntimeSessionSummary[]>;
  /**
   * Deletes credential holders on their own, without touching a session.
   * Used to retry a cleanup that failed after the session was already gone.
   */
  deleteVaults?(vaultIds: string[]): Promise<void>;
}

export interface RuntimeSessionSummary {
  runtimeSessionId: string;
  startedAt: Date;
  /**
   * The project this container belongs to, when the backend can say. Null
   * means unattributable, which the sweep treats as "do not touch unless every
   * project has opted in" — a container of unknown ownership is exactly the
   * one you least want to guess about.
   */
  projectId?: string | null;
}

export const RUNNER_CLOUD = Symbol("RUNNER_CLOUD");
