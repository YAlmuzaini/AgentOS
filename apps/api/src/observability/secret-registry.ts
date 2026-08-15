/**
 * Every secret value this process has resolved, so telemetry can remove it.
 *
 * Pattern matching is not a boundary. The scrubber recognises Anthropic keys,
 * URL credentials and a few other shapes, but an operator's granted secrets are
 * arbitrary: a bare GitHub token, a JWT, an MCP server's opaque bearer, a value
 * stored under a name nobody thought to list. None of those match a shape, and
 * they reach error text by an ordinary route — a runner quotes the response
 * that failed, the control plane wraps it, and the reporter ships it.
 *
 * So the values themselves are registered as they are resolved, and redaction
 * becomes exact-match rather than guesswork. Nothing here is ever read back:
 * the only operation is "remove these strings from this text".
 */
const secrets = new Set<string>();

/**
 * Values shorter than this are not registered.
 *
 * A short secret would match far too much ordinary text — redacting every
 * occurrence of a four-character value would destroy the report it is meant to
 * make safe, and a secret that short is not one worth protecting this way.
 */
const MIN_LENGTH = 12;

/**
 * Bounded so a long-running process cannot grow this without limit.
 *
 * Well past any realistic number of distinct secrets for one operator; the cap
 * exists because this set is fed by a loop that runs on every provision.
 */
const MAX_ENTRIES = 500;

/** Records a resolved secret. Safe to call repeatedly with the same value. */
export function registerSecret(value: string | null | undefined): void {
  if (!value || value.length < MIN_LENGTH || secrets.size >= MAX_ENTRIES) {
    return;
  }
  secrets.add(value);
}

/** Removes every registered secret from `text`, whatever shape it has. */
export function redactRegistered(text: string): string {
  let output = text;
  for (const secret of secrets) {
    if (output.includes(secret)) {
      output = output.split(secret).join("<redacted-secret>");
    }
  }
  return output;
}

/** Test-only: forget everything registered so far. */
export function clearRegisteredSecrets(): void {
  secrets.clear();
}
