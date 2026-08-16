import { type Database, sessions } from "@agentos/db";
import { TERMINAL_SESSION_STATUSES } from "@agentos/shared";
import { and, asc, eq, gt, inArray, lt, or, sql } from "drizzle-orm";
import type { SessionRow } from "./sessions.service";

/**
 * The credential-cleanup retry queue, as one query.
 *
 * The session row keeps its vault ids until a delete succeeds, so this list
 * *is* the queue — nothing separate to keep in sync, and nothing forgotten
 * because a process died between the failure and the retry.
 */
export function pendingVaultQuery(
  db: Database,
  staleMinutes: number,
  limit: number,
  after: Date | null,
): Promise<SessionRow[]> {
  const cutoff = new Date(Date.now() - staleMinutes * 60_000);
  // Selected in SQL rather than by filtering a page of recent rows. Taking
  // the newest 200 and filtering meant a stranded vault fell off the list as
  // soon as 200 newer sessions existed — permanently, and silently. Oldest
  // first for the same reason: the page has to drain the backlog, not the
  // fresh end of it.
  return db
    .select()
    .from(sessions)
    .where(
      and(
        sql`jsonb_array_length(${sessions.runtimeVaultIds}) > 0`,
        // The cursor is what lets the caller walk past rows whose deletion
        // keeps failing, instead of retrying the same page forever.
        after ? gt(sessions.startedAt, after) : undefined,
        or(
          inArray(sessions.status, [...TERMINAL_SESSION_STATUSES]),
          // A session still `starting` long after it began is a crash
          // between minting the vault and attaching the runtime.
          and(eq(sessions.status, "starting"), lt(sessions.startedAt, cutoff)),
        ),
      ),
    )
    .orderBy(asc(sessions.startedAt))
    .limit(limit);
  }

