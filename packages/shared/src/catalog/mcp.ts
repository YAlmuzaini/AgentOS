/**
 * The MCP catalogue: what AgentOS knows how to connect to, and on what terms.
 *
 * **Everything here is _cataloged_, not _verified_.** An entry says "this URL,
 * this transport, this authentication, and these are the risks" — all of it
 * read from the vendor's own documentation and none of it proved by contacting
 * the server. A connection becomes verified only when a handshake actually
 * succeeds against it, which is a separate, opt-in act.
 *
 * Two limits shape the whole list, and both are the runtime's rather than a
 * shortlist of ours:
 *
 * - **No stdio.** The cloud path publishes each server to Managed Agents as
 *   `auth: { type: "static_bearer", mcp_server_url, token }`; the local path
 *   builds `{ type: "http", url, headers }` for the SDK. A server launched as
 *   `npx -y some-mcp-server` cannot be expressed at either end, which rules out
 *   most of the published ecosystem — filesystem, sqlite, memory, and most
 *   vendor packages.
 * - **No OAuth.** Linear, Notion, Sentry, Atlassian, Asana and Slack all
 *   publish remote endpoints and all expect an authorisation-code flow. A
 *   bearer field cannot hold that, so they are absent rather than listed and
 *   broken. Stripe is here only because it documents a bearer alternative.
 *
 * A third limit is not about the servers but about one runner: **Claude Code
 * attaches an MCP server whole.** There is no per-tool gate locally, so a
 * connection granted with a non-empty `allowedOperations` is refused by the
 * local worker rather than silently widened — fail closed, and visible in the
 * session log. The cloud runner does enforce the list, per tool.
 */

import { DEFAULT_MCP } from "./mcp-default";
import { OPT_IN_MCP } from "./mcp-optin";
import type { McpSeed } from "./types";

/** Everything catalogued, installed or not. What the catalogue endpoint returns. */
export const MCP_CATALOG: McpSeed[] = [...DEFAULT_MCP, ...OPT_IN_MCP];

/**
 * What `install-built-ins` actually creates.
 *
 * Read-only or free entries only. Anything billable or mutating stays one
 * deliberate click away — see `mcp-optin.ts`.
 */
export const BUILT_IN_MCP: McpSeed[] = MCP_CATALOG.filter((entry) => entry.installByDefault);

export { DEFAULT_MCP, OPT_IN_MCP };
