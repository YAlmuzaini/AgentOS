import { readFileSync } from "node:fs";
/**
 * Worker configuration.
 *
 * This process runs on a machine the operator owns. It holds a Claude
 * credential and nothing else: no database, no operator token, no AgentOS
 * secrets. Everything a session is allowed to touch arrives in the provision
 * call and dies with the session.
 */
export interface WorkerConfig {
  port: number;
  /** Shared secret the control plane sends as a bearer token. */
  authToken: string;
  /** Where session workspaces are created. */
  workRoot: string;
  /**
   * Allows a `limited` network policy to run without egress enforcement.
   *
   * The cloud runner gets a real egress firewall from Anthropic. A plain VM has
   * none, so honouring `limited` here would be a promise this process cannot
   * keep. Without this flag a limited session is refused outright — a refused
   * session is recoverable, a session that quietly had open internet is not.
   */
  allowUnenforcedNetwork: boolean;
  /** Minutes a session may run before it is torn down regardless. */
  maxSessionMinutes: number;
  /**
   * Model requests one session may push through the credential proxy.
   *
   * The SDK's own spend cap only covers the calls it makes; an agent with a
   * shell can call the proxy directly, and this is the ceiling on that.
   */
  maxSessionRequests: number;
}

export interface Credential {
  kind: "oauth" | "api-key";
  /**
   * The secret itself. It is handed to the credential proxy and nowhere else —
   * in particular it never reaches the agent's process environment, where a
   * Bash tool could read it.
   */
  value: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const authToken = env.LOCAL_RUNNER_TOKEN ?? "";
  if (!authToken) {
    throw new Error(
      "LOCAL_RUNNER_TOKEN is not set — refusing to start. This worker executes " +
        "whatever the control plane sends it; unauthenticated is not an option.",
    );
  }
  return {
    // Named for the worker rather than a bare PORT: in development this
    // process reads the same .env as the control plane, and a generic name
    // there would collide with the first tool that wants one.
    port: Number(env.LOCAL_RUNNER_PORT ?? 4600),
    authToken,
    workRoot: env.LOCAL_RUNNER_WORK_ROOT ?? "/tmp/agentos-local",
    allowUnenforcedNetwork: env.LOCAL_RUNNER_ALLOW_UNENFORCED_NETWORK === "1",
    maxSessionMinutes: Number(env.LOCAL_RUNNER_MAX_SESSION_MINUTES ?? 120),
    maxSessionRequests: Number(env.LOCAL_RUNNER_MAX_SESSION_REQUESTS ?? 500),
  };
}

/**
 * Resolves the Claude credential, preferring the subscription token.
 *
 * This is the whole economic argument for the local runner: `CLAUDE_CODE_OAUTH_TOKEN`
 * (from `claude setup-token`) bills against a Claude subscription at a flat
 * rate, where `ANTHROPIC_API_KEY` is metered per token. Running this worker on
 * an API key costs roughly what the cloud runner costs while giving up
 * Anthropic's sandbox and egress firewall — the worst of both. The API key is
 * supported as a fallback because some operators genuinely want it; it is not
 * the default for a reason.
 */
export function resolveCredential(env: NodeJS.ProcessEnv = process.env): Credential {
  // Files first, and they are the better option on Linux: `/proc/<pid>/environ`
  // exposes a process's *initial* environment to anything running as the same
  // user, and unsetting the variable afterwards does not change that. A file
  // the worker reads and closes is never in that block at all.
  const oauthFile = readIfPresent(env.CLAUDE_CODE_OAUTH_TOKEN_FILE);
  if (oauthFile) {
    return { kind: "oauth", value: oauthFile };
  }
  const keyFile = readIfPresent(env.ANTHROPIC_API_KEY_FILE);
  if (keyFile) {
    return { kind: "api-key", value: keyFile };
  }
  if (env.CLAUDE_CODE_OAUTH_TOKEN) {
    return { kind: "oauth", value: env.CLAUDE_CODE_OAUTH_TOKEN };
  }
  if (env.ANTHROPIC_API_KEY) {
    return { kind: "api-key", value: env.ANTHROPIC_API_KEY };
  }
  throw new Error(
    "no Claude credential. Run `claude setup-token` on this machine and set " +
      "CLAUDE_CODE_OAUTH_TOKEN (or CLAUDE_CODE_OAUTH_TOKEN_FILE, which keeps it out " +
      "of this process's environment block), or set ANTHROPIC_API_KEY to bill per " +
      "token instead.",
  );
}

function readIfPresent(path: string | undefined): string | null {
  if (!path) {
    return null;
  }
  const value = readFileSync(path, "utf8").trim();
  return value.length > 0 ? value : null;
}
