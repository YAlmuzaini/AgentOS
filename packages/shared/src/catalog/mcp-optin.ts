/**
 * Catalogued, and deliberately not installed.
 *
 * Each of these spends money, mutates a real system, or both. They are here so
 * the operator can install one in a click with a URL and a warning we have
 * actually checked — the alternative is not that they go without, it is that
 * they paste a broader URL from a search result.
 *
 * `installByDefault: false` is the whole difference. `install-built-ins` skips
 * them; the catalogue endpoint returns them so the UI can offer them.
 */

import type { McpSeed } from "./types";

export const OPT_IN_MCP: McpSeed[] = [
  {
    slug: "github-write",
    name: "GitHub (read/write)",
    category: "engineering",
    description:
      "The full GitHub MCP surface, including opening pull requests and pushing branches. Install it only for an agent that is meant to write through the API, and never alongside untrusted input.",
    url: "https://api.githubcopilot.com/mcp/",
    transport: "http",
    auth: "bearer",
    cloudCompatible: true,
    localCompatible: true,
    localRequiresAllTools: true,
    risks: ["mutating", "high-risk"],
    credentialEnvVar: "GITHUB_MCP_PAT",
    credentialRequired: true,
    hosts: ["api.githubcopilot.com"],
    docsUrl: "https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md",
    installByDefault: false,
    allowedOperations: [],
    docs:
      "Prefer `github-readonly` unless an agent genuinely has to write. The risk here is not " +
      "the agent misbehaving so much as the input it reads: issue bodies, pull request " +
      "comments and code review threads are attacker-controlled text, and this connection " +
      "gives the model reading them the ability to act on them. On the local runner the whole " +
      "tool surface is attached — the worker cannot filter per tool — so scoping has to come " +
      "from the token. GitHub also publishes per-toolset endpoints such as " +
      "`/mcp/x/issues` and `/mcp/x/pull_requests/readonly`; editing this connection's URL to " +
      "one of those is the narrowest way to grant exactly one job.",
  },
  {
    slug: "apify-actors",
    name: "Apify Actors (billable)",
    category: "research",
    description:
      "Runs published Apify scrapers and automation Actors. Every run is billed to your Apify account, so install it only for a task with a spend cap.",
    url: "https://mcp.apify.com?telemetry-enabled=false",
    transport: "http",
    auth: "bearer",
    cloudCompatible: true,
    localCompatible: true,
    localRequiresAllTools: true,
    risks: ["billable", "mutating"],
    credentialEnvVar: "APIFY_TOKEN",
    credentialRequired: true,
    hosts: ["mcp.apify.com"],
    docsUrl: "https://github.com/apify/actors-mcp-server",
    installByDefault: false,
    allowedOperations: [],
    docs:
      "This is Apify's default tool set — `actors`, `docs`, and the `rag-web-browser` Actor — " +
      "with telemetry disabled through the documented `telemetry-enabled=false` parameter. " +
      "**Actor runs cost money.** Never grant this to an agent inside a goal loop without a " +
      "spend cap: a retry loop over a paid scraper is the cheapest way to a surprising " +
      "invoice. Narrow it further with `?tools=` if you know which Actor you need.",
  },
  {
    slug: "stripe",
    name: "Stripe",
    category: "operations",
    description:
      "Customers, subscriptions, invoices and payments. It can issue refunds and write through the Stripe API, so it is never granted automatically and never belongs on a code agent.",
    url: "https://mcp.stripe.com",
    transport: "http",
    auth: "bearer",
    cloudCompatible: true,
    localCompatible: true,
    localRequiresAllTools: true,
    risks: ["mutating", "high-risk"],
    credentialEnvVar: "STRIPE_RESTRICTED_KEY",
    credentialRequired: true,
    hosts: ["mcp.stripe.com"],
    docsUrl: "https://docs.stripe.com/mcp",
    installByDefault: false,
    allowedOperations: [],
    docs:
      "Use a **restricted** key (`rk_...`), never a secret key, and start in a sandbox. There " +
      "is no read-only URL for this server: the tool list includes `stripe_api_write` and " +
      "`create_refund`, so the key's permissions are the only boundary that exists — give it " +
      "read scopes and add write ones deliberately, one at a time. Stripe's own documentation " +
      "recommends human confirmation of tool calls and warns about prompt injection when this " +
      "server is combined with others; AgentOS has no per-tool confirmation, so the " +
      "conservative posture is a read-scoped sandbox key on an agent that holds no repository " +
      "and no web search.",
  },
];
