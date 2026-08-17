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
 * A short secret matches far too much ordinary text: redacting every
 * occurrence of a four-character value destroys the report it is meant to make
 * safe. Eight rather than twelve so this agrees with the local worker's own
 * floor — a granted value the worker treats as a credential and scrubs was
 * otherwise ignored here, so the same string was protected on one path and
 * stored on the other.
 */
const MIN_LENGTH = 8;

/**
 * Bounded so a long-running process cannot grow this without limit.
 *
 * Well past any realistic number of distinct secrets for one operator; the cap
 * exists because this set is fed by a loop that runs on every provision.
 */
const MAX_ENTRIES = 500;

/**
 * Records a resolved secret. Safe to call repeatedly with the same value.
 *
 * At the cap the *oldest* entry is dropped rather than the new one refused.
 * That distinction became load-bearing with GitHub App installation tokens:
 * they rotate roughly hourly and each one is a new distinct value, so a
 * refusing cap meant a long-running process eventually stopped protecting
 * every credential minted after it filled — silently, and precisely for the
 * short-lived tokens most likely to appear in a fresh error. An old entry is
 * the safer thing to lose: by the time 500 newer secrets have been resolved,
 * it has almost certainly expired or been rotated.
 */
export function registerSecret(value: string | null | undefined): void {
  if (!value || value.length < MIN_LENGTH) {
    return;
  }
  // Re-inserting an existing value would keep its original position, so it is
  // deleted first — a secret still in use should not age out ahead of one that
  // has not been seen since.
  secrets.delete(value);
  secrets.add(value);
  while (secrets.size > MAX_ENTRIES) {
    const oldest = secrets.values().next();
    if (oldest.done) {
      break;
    }
    secrets.delete(oldest.value);
  }
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
