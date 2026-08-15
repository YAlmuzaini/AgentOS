import { type Database, goals } from "@agentos/db";
import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { DATABASE } from "../db/db.module";

/**
 * How long a dispatch slot is held before it is considered abandoned. Longer
 * than any single session should take, and renewed while one is live.
 */
export const LEASE_MINUTES = 60;

/**
 * The goal's single dispatch slot, as three SQL statements.
 *
 * Separated from `GoalsService` because both the goal orchestrator *and* the
 * session resumer need it, and the resumer lives in the runner module — which
 * the goals module already depends on. Only the database is needed here, so
 * this can be global and neither side has to import the other.
 */
@Injectable()
export class GoalLeases {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Takes the slot, returning an opaque token, or null if someone holds it.
   *
   * A goal is a spend cap with a loop attached, and two dispatches each read
   * the same remaining budget and can each spend all of it — so this is a money
   * rule, not a tidiness one.
   */
  async claim(id: string, leaseMinutes = LEASE_MINUTES): Promise<string | null> {
    const cutoff = new Date(Date.now() - leaseMinutes * 60_000);
    const token = randomUUID();
    const rows = await this.db
      .update(goals)
      .set({ dispatchLeaseAt: new Date(), dispatchLeaseToken: token })
      .where(
        and(eq(goals.id, id), or(isNull(goals.dispatchLeaseAt), lt(goals.dispatchLeaseAt, cutoff))),
      )
      .returning({ id: goals.id });
    return rows.length > 0 ? token : null;
  }

  /**
   * Extends the lease while a dispatch is still alive.
   *
   * Without renewal the lease expires under a specialist that is legitimately
   * still running, a queued duplicate claims the goal, and two specialists
   * spend the same budget. False means the slot is no longer ours.
   */
  async renew(id: string, token: string): Promise<boolean> {
    const rows = await this.db
      .update(goals)
      .set({ dispatchLeaseAt: new Date() })
      .where(and(eq(goals.id, id), eq(goals.dispatchLeaseToken, token)))
      .returning({ id: goals.id });
    return rows.length > 0;
  }

  /**
   * Hands the slot back, if it is still ours.
   *
   * Only the holder may release. An unconditional clear let a worker whose
   * lease had already expired wipe the lease of whoever took over from it.
   */
  async release(id: string, token: string): Promise<void> {
    await this.db
      .update(goals)
      .set({ dispatchLeaseAt: null, dispatchLeaseToken: null })
      .where(and(eq(goals.id, id), eq(goals.dispatchLeaseToken, token)));
  }
}
