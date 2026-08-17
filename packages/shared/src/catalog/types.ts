import type { Category } from "./categories";

/**
 * A role AgentOS ships. Installing one writes an `agents` row with
 * `built_in = true`, which is the marker that lets the installer refresh its
 * own text later without touching an agent the operator wrote.
 *
 * `description` is not decoration. It is the sentence the operator reads when
 * they are picking who takes a task, so it has to say **what the role does and
 * when to reach for it** — the same rule Anthropic's Agent Skills spec puts on
 * a skill description, and for the same reason: it is the only text a reader
 * sees before committing.
 */
export interface RoleSeed {
  name: string;
  title: string;
  category: Category;
  description: string;
  rolePrompt: string;
  /**
   * Agents this role may spawn. Absent means it spawns nobody, which is the
   * default and the safe one — the collaboration list is the only path by
   * which one agent starts another (SPEC §5.10).
   */
  collaboration?: string[];
  /**
   * Set when the role thinks rather than types. Everything else runs on the
   * cheaper worker model.
   */
  planner?: boolean;
  /**
   * Skills this role works better with, by slug.
   *
   * A **recommendation**, and only applied when the agent is first created. A
   * re-install never touches an existing agent's `skillIds`: an operator who
   * removed a skill from `senior-dev` meant it, and having the installer put it
   * back is the same class of bug as a re-seed rewriting a role prompt.
   *
   * Slugs that are not installed in the project are skipped rather than
   * failing the install — skills and agents are installed by separate buttons,
   * in either order.
   */
  recommendedSkills?: string[];
}

/** A skill AgentOS ships. Unique per project by slug. */
export interface SkillSeed {
  slug: string;
  name: string;
  category: Category;
  /** What it does and when it applies. Shown wherever a skill is picked. */
  description: string;
  kind: "prompt" | "file";
  body: string;
}

/** Everything both runners can currently speak. Kept as a union so adding
 * stdio later is a compile error at every site that has to learn about it. */
export const MCP_TRANSPORTS = ["http"] as const;
export type McpTransport = (typeof MCP_TRANSPORTS)[number];

/** How the server authenticates. OAuth is deliberately absent: see `mcp.ts`. */
export const MCP_AUTH_KINDS = ["none", "bearer"] as const;
export type McpAuthKind = (typeof MCP_AUTH_KINDS)[number];

/**
 * What granting this server can cost or change.
 *
 * Not severity levels — a server can be several of these at once, and the
 * combination is what an operator needs before handing it to an unattended
 * agent. `billable` and `mutating` are the two that turn a bad afternoon into
 * an invoice or a refund.
 */
export const MCP_RISKS = ["read-only", "mutating", "billable", "high-risk"] as const;
export type McpRisk = (typeof MCP_RISKS)[number];

/**
 * An MCP connection AgentOS ships as a starting point.
 *
 * Every entry is a **remote server over HTTP with either no auth or a static
 * bearer token**, because that is the whole of what both runners can carry: the
 * cloud path publishes `auth: { type: "static_bearer", mcp_server_url, token }`
 * to Managed Agents, and the local path builds `{ type: "http", url, headers }`
 * for the SDK. A `npx`-launched stdio server cannot be expressed here at all,
 * and an OAuth server cannot either.
 *
 * Installing an entry creates the connection and **grants it to nobody**. An
 * agent still has to list it (SPEC §5.1, default deny).
 *
 * Everything here is **cataloged**, meaning "declared compatible by transport
 * and authentication". It is not "verified": no entry has been handshaken
 * against its live server by the act of being written down. `verifiedAt` on the
 * connection row is the only thing that means verified.
 */
export interface McpSeed {
  slug: string;
  name: string;
  category: Category;
  description: string;
  url: string;
  transport: McpTransport;
  auth: McpAuthKind;
  /** Managed Agents accepts remote URLs with a static bearer, so: always true today. */
  cloudCompatible: boolean;
  /** Claude Code accepts an http server with headers, so: always true today. */
  localCompatible: boolean;
  /**
   * True when the local runner can only attach this server *whole*.
   *
   * Claude Code attaches an MCP server as a unit — there is no per-tool gate —
   * so a grant that names specific operations cannot be honoured there. The
   * worker fails closed and refuses to attach such a server at all, which is
   * correct but surprising, and the UI has to say it before the operator
   * discovers it in a session log.
   */
  localRequiresAllTools: boolean;
  risks: McpRisk[];
  /**
   * The env var the operator points a secret reference at, or null when the
   * server needs no credential. Never a value — references only (SPEC §5.8).
   */
  credentialEnvVar: string | null;
  /** False when the server answers unauthenticated, just with lower limits. */
  credentialRequired: boolean;
  /**
   * Hostnames this server talks to, for a `limited` environment's allowlist.
   * Carried, never applied: adding a host is the operator's decision, and doing
   * it automatically would widen a wall on their behalf (SPEC §5.5).
   */
  hosts: string[];
  /** The vendor's own documentation, for the operator to check our claims. */
  docsUrl: string;
  /**
   * Whether `installBuiltInMcp` creates this one.
   *
   * False for the entries that spend money or mutate a real system. They stay
   * in the catalogue, visible and one click away, because hiding them would
   * just mean the operator pastes a worse URL by hand.
   */
  installByDefault: boolean;
  /**
   * Tools to enable, or empty for all of them. Enforced on the cloud runner;
   * on the local runner a non-empty list means the server is not attached at
   * all — see `localRequiresAllTools`.
   */
  allowedOperations: string[];
  /** Where the credential comes from, and anything surprising. */
  docs: string;
}
