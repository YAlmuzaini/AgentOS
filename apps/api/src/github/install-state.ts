import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const TTL_MS = 15 * 60 * 1000;
const MAX_PENDING = 32;

export interface InstallState {
  projectId: string;
}

/**
 * The only thing authenticating GitHub's setup callback.
 *
 * That callback is a GET the browser is redirected to; it cannot carry the
 * operator token, and its query string is entirely attacker-suppliable. So the
 * `state` parameter is the whole authentication story and is treated like a
 * credential: 32 random bytes, stored only as a SHA-256 digest, single-use, and
 * compared in constant time.
 *
 * Held in memory rather than Redis. The window between redirect and callback is
 * seconds, the API is one process, and the failure mode of a restart in that
 * window is "press Connect again" — which is worth more than another moving
 * part holding a short-lived token.
 */
export class InstallStateStore {
  private readonly pending = new Map<string, { state: InstallState; expiresAt: number }>();

  issue(state: InstallState): string {
    this.sweep();
    // A bounded map: an unauthenticated caller cannot reach `issue`, but a
    // stuck client retrying forever should not grow the process either.
    if (this.pending.size >= MAX_PENDING) {
      const oldest = [...this.pending.entries()].sort(
        (a, b) => a[1].expiresAt - b[1].expiresAt,
      )[0];
      if (oldest) {
        this.pending.delete(oldest[0]);
      }
    }
    const token = randomBytes(32).toString("base64url");
    this.pending.set(digest(token), { state, expiresAt: Date.now() + TTL_MS });
    return token;
  }

  /** Returns the state and destroys it: a callback replayed is a callback refused. */
  consume(token: string | undefined): InstallState | null {
    this.sweep();
    if (!token) {
      return null;
    }
    const key = digest(token);
    for (const [stored, entry] of this.pending) {
      if (equal(stored, key)) {
        this.pending.delete(stored);
        return entry.expiresAt > Date.now() ? entry.state : null;
      }
    }
    return null;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.pending) {
      if (entry.expiresAt <= now) {
        this.pending.delete(key);
      }
    }
  }
}

function digest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function equal(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}
