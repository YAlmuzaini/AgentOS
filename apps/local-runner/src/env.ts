/**
 * The environment a session's own processes inherit.
 *
 * Shared by both engines, because both spawn processes the agent controls: the
 * Claude engine hands this to the SDK, and the Grok engine hands it to its
 * shell tool. Credentials are stripped by name — they belong to the worker,
 * and the child gets a placeholder or nothing at all.
 */
export function inheritableEnv(): Record<string, string> {
  const withheld = new Set([
    "CLAUDE_CODE_OAUTH_TOKEN",
    "CLAUDE_CODE_OAUTH_TOKEN_FILE",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_API_KEY_FILE",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    // The Grok engine's own credential. It is used by *this* process to call
    // xAI; the agent's shell has no business reading it, and unlike the
    // Anthropic path there is no proxy standing in front of it.
    "GROK_API_KEY",
    "GROK_API_KEY_FILE",
    "XAI_API_KEY",
    "LOCAL_RUNNER_TOKEN",
    // The control plane's own secrets, in case this worker shares a .env with
    // it in development.
    "AGENTOS_OPERATOR_TOKEN",
    "WEBHOOK_MASTER_SECRET",
    "DATABASE_URL",
    "REDIS_URL",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "VAPID_PRIVATE_KEY",
  ]);
  const inherited: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !withheld.has(key)) {
      inherited[key] = value;
    }
  }
  return inherited;
}

/**
 * Environment keys a session's own bindings may never set.
 *
 * The credential proxy and the egress proxy are both configured through the
 * child's environment, so a granted variable called `ANTHROPIC_BASE_URL` or
 * `HTTPS_PROXY` is not a variable — it is a way to switch off containment or
 * point the run at a metered credential. Bindings are filtered against this,
 * and the runtime's own values are applied afterwards regardless.
 */
const RESERVED_KEYS = new Set([
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN_FILE",
  "GROK_API_KEY",
  // The path is as good as the key: a child that learns where the file is
  // reads it, because the same unix user owns both.
  "GROK_API_KEY_FILE",
  "XAI_API_KEY",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "LOCAL_RUNNER_TOKEN",
]);

/** The granted bindings, minus anything that would reconfigure the runtime. */
export function grantedEnv(
  vars: Array<{ key: string; value: string }>,
  onRefused?: (key: string) => void,
): Record<string, string> {
  const allowed: Record<string, string> = {};
  for (const variable of vars) {
    if (RESERVED_KEYS.has(variable.key)) {
      onRefused?.(variable.key);
      continue;
    }
    allowed[variable.key] = variable.value;
  }
  return allowed;
}
