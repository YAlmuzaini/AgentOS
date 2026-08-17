/**
 * The MCP connections `install-built-ins` creates.
 *
 * Every one of these is read-only, or read-mostly and free, against its
 * vendor's own documented remote endpoint. Anything that spends money or
 * changes a real system lives in `mcp-optin.ts` and is never installed for you.
 *
 * The URLs are chosen, not copied. Where a vendor publishes a narrower
 * endpoint — GitHub's `/readonly`, Apify's `tools=` — the narrow one is the
 * default here, because the default is what an unattended agent will be handed
 * on a tired Friday.
 */

import type { McpSeed } from "./types";

export const DEFAULT_MCP: McpSeed[] = [
  {
    slug: "github-readonly",
    name: "GitHub (read-only)",
    category: "engineering",
    description:
      "Reads repositories, issues, pull requests and CI over GitHub's own hosted MCP server. Grant it to agents that need to understand a repo through the API; it cannot write.",
    // GitHub documents a read-only variant of every endpoint. Using it as the
    // default means a leaked prompt, a confused agent, or a prompt injection in
    // an issue body cannot open a pull request or push a branch — the server
    // itself refuses, independently of what the token's scopes allow.
    url: "https://api.githubcopilot.com/mcp/readonly",
    transport: "http",
    auth: "bearer",
    cloudCompatible: true,
    localCompatible: true,
    localRequiresAllTools: true,
    risks: ["read-only"],
    credentialEnvVar: "GITHUB_MCP_PAT",
    credentialRequired: true,
    hosts: ["api.githubcopilot.com"],
    docsUrl: "https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md",
    installByDefault: true,
    allowedOperations: [],
    docs:
      "Point a secret reference at a **fine-grained** personal access token scoped to this " +
      "project's repositories, and send it as `Authorization: Bearer`. Two things worth being " +
      "clear about. First, this is a different capability from the GitHub App installation " +
      "AgentOS uses to *clone* a repo: the App grants git access to selected repositories and " +
      "mints an hour-long token; this grants API access and uses whatever you attach here. " +
      "Neither substitutes for the other, and attaching a broad PAT here does not widen the " +
      "clone path or narrow it. Second, the token's scopes are the real boundary — the " +
      "`/readonly` endpoint stops writes at the server, but a token that can read every " +
      "repository you own can read every repository you own. Mint a narrow one.",
  },
  {
    slug: "context7",
    name: "Context7",
    category: "research",
    description:
      "Version-correct documentation and code examples for libraries and frameworks. Grant it to any agent that integrates against an SDK, so it stops implementing from memory.",
    url: "https://mcp.context7.com/mcp",
    transport: "http",
    auth: "bearer",
    cloudCompatible: true,
    localCompatible: true,
    localRequiresAllTools: true,
    risks: ["read-only"],
    credentialEnvVar: "CONTEXT7_API_KEY",
    credentialRequired: false,
    hosts: ["mcp.context7.com"],
    docsUrl: "https://github.com/upstash/context7",
    installByDefault: true,
    allowedOperations: [],
    docs:
      "A free key from context7.com/dashboard raises the rate limit; the server also answers " +
      "without one, so the secret reference is optional. Sent as `Authorization: Bearer`.",
  },
  {
    slug: "deepwiki",
    name: "DeepWiki",
    category: "research",
    description:
      "Generated architecture documentation and question answering over public GitHub repositories. Grant it when an agent needs to understand a dependency it did not write.",
    url: "https://mcp.deepwiki.com/mcp",
    transport: "http",
    auth: "none",
    cloudCompatible: true,
    localCompatible: true,
    localRequiresAllTools: true,
    risks: ["read-only"],
    credentialEnvVar: null,
    credentialRequired: false,
    hosts: ["mcp.deepwiki.com"],
    docsUrl: "https://docs.devin.ai/work-with-devin/deepwiki-mcp",
    installByDefault: true,
    allowedOperations: [],
    docs:
      "No credential and no account. Public repositories only — it cannot see a private one, " +
      "so it is not a substitute for granting the repo itself.",
  },
  {
    slug: "exa",
    name: "Exa search",
    category: "research",
    description:
      "Neural web search and page fetching that returns clean markdown rather than raw HTML. Grant it to research agents that need the live web.",
    // The bare URL is the default tool set — `web_search_exa` and
    // `web_fetch_exa`. The heavier `agent_run` and `web_search_advanced_exa`
    // are opt-in through `?tools=`, and adding them here would enable them for
    // every agent that is ever granted this connection.
    url: "https://mcp.exa.ai/mcp",
    transport: "http",
    auth: "bearer",
    cloudCompatible: true,
    localCompatible: true,
    localRequiresAllTools: true,
    risks: ["read-only", "billable"],
    credentialEnvVar: "EXA_API_KEY",
    credentialRequired: false,
    hosts: ["mcp.exa.ai"],
    docsUrl: "https://github.com/exa-labs/exa-mcp-server",
    installByDefault: true,
    allowedOperations: [],
    docs:
      "Key as `Authorization: Bearer`. Searches draw on your Exa balance, so this is billable " +
      "in the ordinary way an API is — pair it with a task spend cap rather than granting it " +
      "to an agent in a loop. The default tool set is search and fetch; `?tools=` **replaces** " +
      "the defaults rather than adding to them, so a URL that names one tool loses the other.",
  },
  {
    slug: "semgrep",
    name: "Semgrep",
    category: "security",
    description:
      "Static analysis that finds real vulnerability patterns in source rather than guessing from the diff. Grant it to the security reviewer.",
    url: "https://mcp.semgrep.ai/mcp",
    transport: "http",
    auth: "bearer",
    cloudCompatible: true,
    localCompatible: true,
    localRequiresAllTools: true,
    risks: ["read-only"],
    credentialEnvVar: "SEMGREP_APP_TOKEN",
    // Semgrep's README describes the token as optional for the hosted server.
    // A live handshake from here says otherwise: the endpoint answered 401
    // without one. Believing the documentation over the observation would put a
    // connection in every new project that fails on its first real call, so the
    // catalogue records what happened rather than what was written down. This
    // is exactly the gap `verifiedAt` exists to expose.
    credentialRequired: true,
    hosts: ["mcp.semgrep.ai"],
    docsUrl: "https://github.com/semgrep/mcp",
    installByDefault: true,
    allowedOperations: [],
    docs:
      "Needs a Semgrep AppSec Platform token as `Authorization: Bearer`, despite the README " +
      "describing the hosted server as needing no authentication — the endpoint returned 401 " +
      "without one when this entry was verified, and the README also marks it experimental and " +
      "liable to break. **Code is sent to a third party to be scanned**: that follows from the " +
      "architecture, since the scan runs there rather than here. Semgrep's \"nothing leaves your " +
      "machine\" language describes the local engine, not this endpoint, and what is retained " +
      "server-side is not documented — so do not grant it in a project whose source may not " +
      "leave your infrastructure.",
  },
  {
    slug: "cloudflare-docs",
    name: "Cloudflare documentation",
    category: "devops",
    description:
      "Current Cloudflare product and API documentation. Grant it to infrastructure agents working against Workers, R2, or the Cloudflare API.",
    url: "https://docs.mcp.cloudflare.com/mcp",
    transport: "http",
    auth: "none",
    cloudCompatible: true,
    localCompatible: true,
    localRequiresAllTools: true,
    risks: ["read-only"],
    credentialEnvVar: null,
    credentialRequired: false,
    hosts: ["docs.mcp.cloudflare.com"],
    docsUrl:
      "https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/",
    installByDefault: true,
    allowedOperations: [],
    docs:
      "Documentation only, and deliberately not Cloudflare's API server. It reads nothing from " +
      "your Cloudflare account and cannot change anything in it.",
  },
  {
    slug: "huggingface",
    name: "Hugging Face",
    category: "data",
    description:
      "Search models, datasets and Spaces, and read their cards. Grant it to data and ML agents choosing between models.",
    url: "https://huggingface.co/mcp",
    transport: "http",
    auth: "bearer",
    cloudCompatible: true,
    localCompatible: true,
    localRequiresAllTools: true,
    risks: ["read-only"],
    credentialEnvVar: "HF_TOKEN",
    credentialRequired: false,
    hosts: ["huggingface.co"],
    docsUrl: "https://huggingface.co/docs/hub/en/agents-mcp",
    installByDefault: true,
    allowedOperations: [],
    docs:
      "A Hugging Face token as `Authorization: Bearer`. The default tool set is the read-only Hub " +
      "navigation and search tools, which is why this is catalogued as read-only — but write-" +
      "capable groups (Contribute Repos, Sandboxes, Run and Manage Jobs) can be switched on " +
      "per-account at huggingface.co/settings/mcp, and that setting lives on your account rather " +
      "than in this URL. So use a **read-only** token: it is the only part of this that AgentOS " +
      "can see, and it is what stops a session publishing under your name if those groups are " +
      "ever enabled.",
  },
  {
    slug: "apify-docs",
    name: "Apify documentation",
    category: "research",
    description:
      "Searches Apify's documentation and Actor store. Grant it for research about Apify itself; it cannot run an Actor, so it cannot spend anything.",
    // Deliberately narrowed. Apify's *default* tool set is `actors`, `docs` and
    // the `rag-web-browser` Actor — which means the bare URL hands an agent the
    // ability to execute Actors, and Actor runs are billed to the operator's
    // account. `tools=docs` is the documented way to keep the free half.
    // Telemetry is opt-out through the documented parameter, so it is off here.
    url: "https://mcp.apify.com?tools=docs&telemetry-enabled=false",
    transport: "http",
    auth: "bearer",
    cloudCompatible: true,
    localCompatible: true,
    localRequiresAllTools: true,
    risks: ["read-only"],
    credentialEnvVar: "APIFY_TOKEN",
    credentialRequired: true,
    hosts: ["mcp.apify.com"],
    docsUrl: "https://github.com/apify/actors-mcp-server",
    installByDefault: true,
    allowedOperations: [],
    docs:
      "Token as `Authorization: Bearer`. This URL is scoped to the documentation tools on " +
      "purpose: Apify's default tool set includes Actor execution, and an Actor run is billed " +
      "to your account. If you want an agent to actually run scrapers, install the separate " +
      "`apify-actors` entry rather than widening this one, so the billable capability is a " +
      "grant you can see on the agent.",
  },
];
