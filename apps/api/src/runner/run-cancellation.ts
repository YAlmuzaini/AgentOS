/**
 * Cancellation for one run, and the reason it was cancelled.
 *
 * This replaces an earlier attempt that wrapped the event stream and stopped
 * iterating at a deadline. That did not work, and the way it failed is worth
 * recording: calling `return()` on an async generator that is blocked inside
 * `next()` does not interrupt it — the return is queued *behind* the pending
 * read. So a session that had gone completely silent, which is the only kind a
 * deadline exists for, would hang the consumer instead of being cut off, and
 * the container would never be destroyed.
 *
 * Cancellation has to reach the socket. Both backends now take this signal and
 * hand it to their underlying request, so aborting it fails the in-flight read
 * and the generator unwinds through its own `finally`.
 */
export type CancelReason = "deadline" | "revoked";

/** Node clamps any longer delay to 1ms, which fires a far deadline instantly. */
const MAX_TIMEOUT_MS = 2_147_483_647;

export class RunCancellation {
  private readonly controller = new AbortController();
  private timer: NodeJS.Timeout | undefined;
  private cancelReason: CancelReason | null = null;

  /**
   * @param deadlineAt wall-clock cut-off, or null for none.
   * @param external a signal from the caller — a goal that lost its dispatch
   *   lease revokes its specialist through this rather than letting two run.
   */
  constructor(deadlineAt: Date | null, external?: AbortSignal | null) {
    if (deadlineAt) {
      this.armDeadline(deadlineAt);
    }

    if (external) {
      if (external.aborted) {
        this.cancel("revoked");
      } else {
        external.addEventListener("abort", () => this.cancel("revoked"), { once: true });
      }
    }
  }

  /**
   * Schedules the cut-off, re-arming in chunks when it is far away.
   *
   * `setTimeout` silently clamps any delay above 2^31-1 ms — about 24.85 days —
   * down to 1 ms. A goal is allowed a longer `maxDurationMinutes` than that, so
   * passing the full remaining time meant a 30-day goal cancelled its very
   * first session almost immediately.
   */
  private armDeadline(deadlineAt: Date): void {
    const remaining = deadlineAt.getTime() - Date.now();
    if (remaining <= 0) {
      // Already past: cancel before anything opens a connection at all.
      this.cancel("deadline");
      return;
    }
    const delay = Math.min(remaining, MAX_TIMEOUT_MS);
    this.timer = setTimeout(() => {
      if (delay < remaining) {
        this.armDeadline(deadlineAt);
        return;
      }
      this.cancel("deadline");
    }, delay);
    this.timer.unref?.();
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /** Why the run was cut off, or null if it ended on its own. */
  get reason(): CancelReason | null {
    return this.cancelReason;
  }

  get cancelled(): boolean {
    return this.cancelReason !== null;
  }

  cancel(reason: CancelReason): void {
    if (this.cancelReason) {
      return;
    }
    this.cancelReason = reason;
    this.controller.abort();
  }

  /** Always call this: a pending timer keeps the event loop alive. */
  dispose(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}

/**
 * Whether an error is the abort we caused.
 *
 * Aborting a fetch rejects the in-flight read, so the expected end of a
 * cancelled run arrives as a thrown error rather than a clean return. Treating
 * that as a session failure would report every deadline as a crash.
 */
export function isAbortError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const name = (error as { name?: unknown }).name;
  return name === "AbortError" || name === "APIUserAbortError";
}
