/**
 * The slice of the Anthropic Managed Agents beta surface AgentOS uses.
 *
 * The beta namespace's generated types move between SDK releases, so the
 * client is narrowed to this hand-written interface at exactly one place
 * (`asManagedAgents`). If a call shape changes upstream, it breaks here rather
 * than in five call sites.
 */

export interface MaEnvironment {
  id: string;
  name: string;
}

export interface MaAgent {
  id: string;
  name: string;
  version: number;
  metadata?: Record<string, string> | null;
}

export interface MaSession {
  id: string;
  status: string;
  created_at?: string | null;
  metadata?: Record<string, string> | null;
  usage?: { list_cost?: { amount?: string; currency?: string } | null } | null;
}

/** Runtime events we care about. Everything else is logged verbatim. */
export interface MaEvent {
  id?: string;
  type: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: Array<{ type: string; text?: string }>;
  stop_reason?: { type?: string } | null;
  error?: { message?: string } | null;
  [key: string]: unknown;
}

export interface MaNetworkingUnrestricted {
  type: "unrestricted";
}

export interface MaNetworkingLimited {
  type: "limited";
  allow_package_managers: boolean;
  allow_mcp_servers: boolean;
  allowed_hosts: string[];
}

export interface MaVault {
  id: string;
}

export interface ManagedAgentsApi {
  vaults: {
    create(body: Record<string, unknown>): Promise<MaVault>;
    delete(id: string): Promise<unknown>;
    credentials: {
      create(vaultId: string, body: Record<string, unknown>): Promise<{ id: string }>;
    };
  };
  environments: {
    create(body: {
      name: string;
      config: { type: "cloud"; networking: MaNetworkingUnrestricted | MaNetworkingLimited };
    }): Promise<MaEnvironment>;
    list(): AsyncIterable<MaEnvironment>;
  };
  agents: {
    create(body: Record<string, unknown>): Promise<MaAgent>;
    update(id: string, body: Record<string, unknown>): Promise<MaAgent>;
    list(): AsyncIterable<MaAgent>;
  };
  sessions: {
    create(body: Record<string, unknown>): Promise<MaSession>;
    retrieve(id: string): Promise<MaSession>;
    archive(id: string): Promise<unknown>;
    list(query?: Record<string, unknown>): AsyncIterable<MaSession>;
    events: {
      /**
       * `options.signal` is what makes a run cancellable. Abandoning the
       * returned iterator does not interrupt a pending read; aborting the
       * request does. Verified against the installed SDK's `RequestOptions`.
       */
      stream(
        sessionId: string,
        params?: undefined,
        options?: { signal?: AbortSignal },
      ): Promise<AsyncIterable<MaEvent>> | AsyncIterable<MaEvent>;
      send(sessionId: string, body: { events: Record<string, unknown>[] }): Promise<unknown>;
      list(sessionId: string): AsyncIterable<MaEvent>;
    };
  };
}

/** Single documented narrowing point for the beta namespace. */
export function asManagedAgents(betaNamespace: unknown): ManagedAgentsApi {
  return betaNamespace as ManagedAgentsApi;
}
