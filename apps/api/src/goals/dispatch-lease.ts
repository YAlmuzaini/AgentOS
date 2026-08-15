import type { Logger } from "@nestjs/common";
import type { GoalLeases } from "./goal-leases";

/** How often a live dispatch extends its hold on the goal. */
const RENEW_EVERY_MS = 5 * 60_000;

/** Consecutive renewal errors after which the dispatch gives up its turn. */
const MAX_RENEWAL_FAILURES = 3;

/**
 * One goal's dispatch slot, held for the length of one specialist.
 *
 * A goal is a spend cap with a loop attached, so "one specialist at a time" is
 * a money rule, not a tidiness one: two dispatches each read the same remaining
 * budget and can each spend all of it.
 *
 * Two things make that true, and the second is easy to miss. The lease has to
 * be *renewed*, or it expires under a specialist that is legitimately still
 * running and a queued duplicate claims it. And losing the lease has to *stop*
 * this dispatch — whoever holds it now owns the remaining budget, and a
 * previous holder still running beside them is the exact double-spend the lease
 * exists to prevent. Noticing and logging it does not undo it, so the loss is
 * wired to an abort signal that reaches the running session's own connection.
 */
export class DispatchLease {
  private readonly controller = new AbortController();
  private readonly timer: NodeJS.Timeout;
  private failures = 0;

  constructor(
    private readonly leases: GoalLeases,
    private readonly goalId: string,
    private readonly token: string,
    private readonly logger: Logger,
  ) {
    this.timer = setInterval(() => void this.renew(), RENEW_EVERY_MS);
    this.timer.unref?.();
  }

  /** Aborted when this dispatch no longer owns the goal's turn. */
  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /** Stops renewing and hands the slot back, if it is still ours. */
  async release(): Promise<void> {
    clearInterval(this.timer);
    await this.leases.release(this.goalId, this.token);
  }

  private async renew(): Promise<void> {
    try {
      if (await this.leases.renew(this.goalId, this.token)) {
        this.failures = 0;
        return;
      }
      this.logger.warn(`goal ${this.goalId}: lease taken by another dispatch; stopping this one`);
      this.controller.abort();
    } catch (error) {
      this.failures += 1;
      this.logger.warn(`goal ${this.goalId}: lease renewal failed: ${String(error)}`);
      // Fail closed. After this many misses the lease is nearer expiry than
      // health, and continuing risks running beside a replacement.
      if (this.failures >= MAX_RENEWAL_FAILURES) {
        this.controller.abort();
      }
    }
  }
}
