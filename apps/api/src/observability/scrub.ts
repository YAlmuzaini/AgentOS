/**
 * Redacts anything that must not leave this machine (RECIPE A8).
 *
 * Error reports from this app are unusually dangerous to ship raw. A session's
 * tool-call log carries task text, an agent's own messages, and file paths; a
 * provisioning failure quotes the request that failed, which is the one request
 * that carried resolved secrets. So the rule here is redact-by-pattern on every
 * string in the event, not a field allow-list — a field list only protects the
 * fields somebody remembered.
 */
import { redactRegistered } from "./secret-registry";

/** Patterns that are secrets wherever they appear. Order matters: broad last. */
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  // Anthropic keys and setup tokens, in any of their prefixes.
  [/\bsk-ant-[A-Za-z0-9_-]+/g, "sk-ant-<redacted>"],
  // Bearer/x-api-key headers, however they were serialised.
  [/\b(authorization|x-api-key|bearer)\b\s*[:=]?\s*["']?[A-Za-z0-9._~+/-]{16,}={0,2}/gi, "$1 <redacted>"],
  // Credentials inside a URL — git remotes and database URLs both do this.
  [/\/\/[^/\s:@]+:[^/\s@]+@/g, "//<redacted>@"],
  // A bare postgres/redis URL is a credential even without a password.
  [/\b(postgres|postgresql|redis|rediss):\/\/\S+/gi, "$1://<redacted>"],
  // VAPID and generic 64-hex secrets (the operator token's own shape).
  [/\b[a-f0-9]{64}\b/gi, "<redacted-hex64>"],
];

/** Environment variable names whose *values* are redacted wherever they occur. */
const SECRET_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "AGENTOS_OPERATOR_TOKEN",
  "LOCAL_RUNNER_TOKEN",
  "WEBHOOK_MASTER_SECRET",
  "S3_SECRET_ACCESS_KEY",
  "S3_ACCESS_KEY_ID",
  "VAPID_PRIVATE_KEY",
  "DATABASE_URL",
];

/**
 * Free text an agent or operator wrote. Not a secret, but not ours to ship:
 * a task description is the founder's business, and it is the single most
 * likely place for a customer's name to appear.
 */
const NARRATIVE_KEYS = new Set([
  "description",
  "brief",
  "spec",
  "prompt",
  "systemPrompt",
  "kickoff",
  "body",
  "note",
  "question",
  "summary",
  "progressLog",
  "toolCallLog",
]);

/** Redacts secrets in one string. Safe to call on anything. */
export function scrubText(input: string): string {
  // Exact-match first, and it is the part that actually holds. The patterns
  // below only recognise shapes we thought of; this removes the values this
  // process has genuinely resolved, whatever they look like.
  let output = redactRegistered(input);
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    output = output.replace(pattern, replacement);
  }
  for (const key of SECRET_ENV_KEYS) {
    const value = process.env[key];
    // Short values would match far too much; a real credential is long.
    if (value && value.length >= 12) {
      output = output.split(value).join(`<${key}>`);
    }
  }
  return output;
}

/**
 * Walks an arbitrary event and scrubs it in place-ish, returning a clean copy.
 *
 * Narrative fields are dropped entirely rather than pattern-scrubbed: there is
 * no regex for "this sentence mentions a customer". Depth is bounded because
 * an event that arrives self-referential must not hang the reporter.
 */
export function scrubEvent<T>(event: T, depth = 0): T {
  if (depth > 8) {
    return "<truncated>" as unknown as T;
  }
  if (typeof event === "string") {
    return scrubText(event) as unknown as T;
  }
  if (Array.isArray(event)) {
    return event.map((entry) => scrubEvent(entry, depth + 1)) as unknown as T;
  }
  if (event && typeof event === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(event as Record<string, unknown>)) {
      output[key] = NARRATIVE_KEYS.has(key) ? "<redacted-content>" : scrubEvent(value, depth + 1);
    }
    return output as unknown as T;
  }
  return event;
}
