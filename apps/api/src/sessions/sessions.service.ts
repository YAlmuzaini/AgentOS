import { type Database, sessions } from "@agentos/db";
import {
  type Runner,
  type SessionDto,
  type SessionStatus,
  type SessionSummaryDto,
  isTerminalSessionStatus,
  TERMINAL_SESSION_STATUSES,
  type ToolCallLogEntry,
} from "@agentos/shared";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, desc, eq, gt, inArray, lt, notInArray, or, sql } from "drizzle-orm";
import { DATABASE } from "../db/db.module";

export type SessionRow = typeof sessions.$inferSelect;

@Injectable()
export class SessionsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * The full rows, tool-call logs included. Internal callers and tests use
   * this; the HTTP list endpoint does not — see `listSummaries`.
   */
  async list(limit = 100): Promise<SessionDto[]> {
    const rows = await this.db
      .select()
      .from(sessions)
      .orderBy(desc(sessions.startedAt))
      .limit(limit);
    return rows.map(toDto);
  }

  /**
   * What the session list screen and the top bar poll.
   *
   * The tool-call log is never selected: it is the bulk of a finished session
   * row, the list renders none of it, and this runs on a 4-second timer. On a
   * seeded database the full-row version of this query was 89 KB per poll to
   * paint a list of ids and statuses.
   */
  async listSummaries(limit = 100): Promise<SessionSummaryDto[]> {
    const rows = await this.db
      .select({
        id: sessions.id,
        projectId: sessions.projectId,
        agentId: sessions.agentId,
        taskId: sessions.taskId,
        goalId: sessions.goalId,
        runner: sessions.runner,
        status: sessions.status,
        runtimeHandle: sessions.runtimeHandle,
        traceUrl: sessions.traceUrl,
        commitShas: sessions.commitShas,
        costUsd: sessions.costUsd,
        error: sessions.error,
        startedAt: sessions.startedAt,
        endedAt: sessions.endedAt,
      })
      .from(sessions)
      .orderBy(desc(sessions.startedAt))
      .limit(limit);

    return rows.map((row) => ({
      ...row,
      costUsd: row.costUsd != null ? Number(row.costUsd) : null,
      startedAt: row.startedAt.toISOString(),
      endedAt: row.endedAt?.toISOString() ?? null,
    }));
  }

  async get(id: string): Promise<SessionDto> {
    return toDto(await this.require(id));
  }

  async create(input: {
    projectId: string;
    agentId: string;
    taskId?: string | null;
    goalId?: string | null;
    runner: Runner;
  }): Promise<SessionRow> {
    const [row] = await this.db
      .insert(sessions)
      .values({
        projectId: input.projectId,
        agentId: input.agentId,
        taskId: input.taskId ?? null,
        goalId: input.goalId ?? null,
        runner: input.runner,
        status: "starting",
      })
      .returning();
    return row!;
  }

  async setStatus(id: string, status: SessionStatus): Promise<void> {
    // Parking stamps the clock the reaper reads; leaving the park clears it,
    // so a session that is answered and later parks again starts over.
    await this.db
      .update(sessions)
      .set({ status, parkedAt: status === "waiting-inbox" ? new Date() : null })
      .where(eq(sessions.id, id));
  }

  /** Sessions that have been waiting on an operator since before `cutoff`. */
  async listParkedSince(cutoff: Date): Promise<SessionRow[]> {
    return this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.status, "waiting-inbox"), lt(sessions.parkedAt, cutoff)));
  }

  /**
   * Every runtime container AgentOS still believes it owns.
   *
   * The orphan sweep compares this against what the runtime reports, so a row
   * missing from here is a container nobody will ever reclaim. Deliberately
   * includes `starting`: a session mid-provision has no handle yet, and its
   * container must not be swept out from under it.
   */
  async liveRuntimeHandles(): Promise<string[]> {
    const rows = await this.db
      .select({ handle: sessions.runtimeHandle })
      .from(sessions)
      .where(notInArray(sessions.status, [...TERMINAL_SESSION_STATUSES]));
    return rows.map((row) => row.handle).filter((handle): handle is string => Boolean(handle));
  }

  /**
   * Records vault ownership as soon as the vaults exist.
   *
   * Deliberately separate from `attachRuntime`: the vaults are created before
   * the runtime session is, and the window between them is exactly where a
   * crash used to strand credentials with nothing pointing at them.
   */
  async recordVaults(id: string, runtimeVaultIds: string[]): Promise<void> {
    if (runtimeVaultIds.length === 0) {
      return;
    }
    await this.db.update(sessions).set({ runtimeVaultIds }).where(eq(sessions.id, id));
  }

  /**
   * Claims a parked session on behalf of an operator's answer.
   *
   * The mirror image of `claimExpiredPark`: both move the session out of
   * `waiting-inbox`, and the database decides which one got there first. The
   * answer moves it to `running` because that is what the resume will do
   * anyway; if it returns false the reaper won, and the answer has nowhere to
   * go.
   */
  async claimForResume(id: string): Promise<boolean> {
    const rows = await this.db
      .update(sessions)
      .set({ status: "running", parkedAt: null })
      .where(and(eq(sessions.id, id), eq(sessions.status, "waiting-inbox")))
      .returning({ id: sessions.id });
    return rows.length > 0;
  }

  /** Corrects the record when a session lands on a different backend. */
  async setRunner(id: string, runner: Runner): Promise<void> {
    await this.db.update(sessions).set({ runner }).where(eq(sessions.id, id));
  }

  /**
   * Undoes a resume claim that could not be completed.
   *
   * Only a session this process itself moved to `running` is put back, so a
   * genuinely running session is never dragged into the park.
   */
  async returnToPark(id: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ status: "waiting-inbox", parkedAt: new Date() })
      .where(and(eq(sessions.id, id), eq(sessions.status, "running")));
  }

  /** Cleared only once the vaults are actually gone. */
  async clearVaults(id: string): Promise<void> {
    await this.db.update(sessions).set({ runtimeVaultIds: [] }).where(eq(sessions.id, id));
  }

  /**
   * Finished sessions whose credential holders were never cleaned up.
   *
   * The row keeps its vault ids until a delete succeeds, so this list *is* the
   * retry queue — no separate bookkeeping, and nothing is forgotten because a
   * process died between the failure and the retry.
   */
  async sessionsWithPendingVaults(
    staleMinutes = 60,
    limit = 500,
    after: Date | null = null,
  ): Promise<SessionRow[]> {
    const cutoff = new Date(Date.now() - staleMinutes * 60_000);
    // Selected in SQL rather than by filtering a page of recent rows. Taking
    // the newest 200 and filtering meant a stranded vault fell off the list as
    // soon as 200 newer sessions existed — permanently, and silently. Oldest
    // first for the same reason: the page has to drain the backlog, not the
    // fresh end of it.
    return this.db
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

  async attachRuntime(
    id: string,
    runtimeHandle: string,
    traceUrl: string | null,
    runtimeVaultIds: string[] = [],
  ): Promise<void> {
    await this.db
      .update(sessions)
      .set({ runtimeHandle, traceUrl, runtimeVaultIds, status: "running" })
      .where(eq(sessions.id, id));
  }

  /**
   * Claims a parked session for reaping, if it is still parked.
   *
   * Returns false when the operator answered first. The check and the write are
   * one statement because the alternative — read, decide, write — destroys live
   * sessions whose answer arrived in between.
   */
  async claimExpiredPark(id: string, reason: string): Promise<boolean> {
    const rows = await this.db
      .update(sessions)
      .set({ status: "failed", error: reason, endedAt: new Date() })
      .where(and(eq(sessions.id, id), eq(sessions.status, "waiting-inbox")))
      .returning({ id: sessions.id });
    return rows.length > 0;
  }

  /**
   * Records that a container outlived its session record.
   *
   * Marking a session `destroyed` while its container is still running is a
   * lie the operator cannot see. This appends the truth to the row so the
   * sessions screen shows it, and leaves the handle in place so the orphan
   * sweep can finish the job.
   */
  async recordDestroyFailure(id: string, detail: string): Promise<void> {
    const row = await this.db.query.sessions.findFirst({ where: eq(sessions.id, id) });
    const existing = row?.error ? `${row.error}\n` : "";
    await this.db
      .update(sessions)
      .set({ error: `${existing}container was not destroyed: ${detail}` })
      .where(eq(sessions.id, id));
  }

  /**
   * Appends to the persisted tool-call log. Written as the events arrive so a
   * crashed run is still replayable (SPEC §6: persist logs before destroy).
   */
  async appendToolCalls(id: string, entries: ToolCallLogEntry[]): Promise<void> {
    if (entries.length === 0) {
      return;
    }
    await this.db
      .update(sessions)
      .set({
        toolCallLog: sql`${sessions.toolCallLog} || ${JSON.stringify(entries)}::jsonb`,
      })
      .where(eq(sessions.id, id));
  }

  async finish(
    id: string,
    input: { status: Extract<SessionStatus, "destroyed" | "failed">; error?: string | null; costUsd?: number | null },
  ): Promise<void> {
    await this.db
      .update(sessions)
      .set({
        status: input.status,
        error: input.error ?? null,
        costUsd: input.costUsd != null ? input.costUsd.toFixed(4) : null,
        endedAt: new Date(),
      })
      .where(eq(sessions.id, id));
  }

  async require(id: string): Promise<SessionRow> {
    const row = await this.db.query.sessions.findFirst({ where: eq(sessions.id, id) });
    if (!row) {
      throw new NotFoundException(`session ${id} not found`);
    }
    return row;
  }
}

export function toDto(row: SessionRow): SessionDto {
  return {
    id: row.id,
    projectId: row.projectId,
    agentId: row.agentId,
    taskId: row.taskId,
    goalId: row.goalId,
    runner: row.runner,
    status: row.status,
    runtimeHandle: row.runtimeHandle,
    traceUrl: row.traceUrl,
    toolCallLog: row.toolCallLog,
    commitShas: row.commitShas,
    costUsd: row.costUsd != null ? Number(row.costUsd) : null,
    error: row.error,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
  };
}
