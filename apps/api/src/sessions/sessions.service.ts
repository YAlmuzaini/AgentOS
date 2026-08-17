import { agents, type Database, sessions } from "@agentos/db";
import {
  type Runner,
  type SessionAccess,
  type SessionPublish,
  type SessionDto,
  type SessionStatus,
  type SessionSummaryDto,
  isTerminalSessionStatus,
  TERMINAL_SESSION_STATUSES,
  type ToolCallLogEntry,
} from "@agentos/shared";
import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, desc, eq, gt, inArray, lt, notInArray, or, sql } from "drizzle-orm";
import { redactRegistered } from "../observability/secret-registry";
import { DATABASE } from "../db/db.module";
import { toDto } from "./session-dto";
import { pendingVaultQuery } from "./pending-vaults";

export type SessionRow = typeof sessions.$inferSelect;

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * The full rows, tool-call logs included. Internal callers and tests use
   * this; the HTTP list endpoint does not — see `listSummaries`.
   */
  async list(limit = 100): Promise<SessionDto[]> {
    const rows = await this.db
      .select({ session: sessions, agentName: agents.name })
      .from(sessions)
      .leftJoin(agents, eq(agents.id, sessions.agentId))
      .orderBy(desc(sessions.startedAt))
      .limit(limit);
    return rows.map((row) => toDto(row.session, row.agentName));
  }

  /**
   * What the session list screen and the top bar poll.
   *
   * The tool-call log is never selected: it is the bulk of a finished session
   * row, the list renders none of it, and this runs on a 4-second timer. On a
   * seeded database the full-row version of this query was 89 KB per poll to
   * paint a list of ids and statuses.
   */
  async listSummaries(projectId?: string, limit = 100): Promise<SessionSummaryDto[]> {
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
        access: sessions.access,
        // Small, and the list is where a failed push has to be visible — a
        // session that kept its workspace needs the operator to notice.
        publish: sessions.publish,
        // Joined rather than fetched per row: the list is what the operator
        // scans, and "which agent" is the first thing they want from it.
        agentName: agents.name,
      })
      .from(sessions)
      .leftJoin(agents, eq(agents.id, sessions.agentId))
      // Applied in SQL rather than after the fact: without it the limit is
      // spent on other projects' runs, so a quiet project can page in empty
      // while a busy one fills the list.
      .where(projectId ? eq(sessions.projectId, projectId) : undefined)
      .orderBy(desc(sessions.startedAt))
      .limit(limit);

    return rows.map((row) => ({
      ...row,
      access: row.access ?? null,
      publish: row.publish ?? null,
      costUsd: row.costUsd != null ? Number(row.costUsd) : null,
      startedAt: row.startedAt.toISOString(),
      endedAt: row.endedAt?.toISOString() ?? null,
    }));
  }

  async get(id: string): Promise<SessionDto> {
    const row = await this.require(id);
    const agent = await this.db.query.agents.findFirst({ where: eq(agents.id, row.agentId) });
    return toDto(row, agent?.name ?? null);
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

  /**
   * Records what this session was given (SPEC §13).
   *
   * Written before the container exists, so a provision that fails still shows
   * the operator what it was about to hand over.
   */
  async recordAccess(id: string, access: SessionAccess): Promise<void> {
    await this.db.update(sessions).set({ access }).where(eq(sessions.id, id));
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
  /**
   * The credentials are revoked. Says nothing about the container.
   *
   * These two were briefly one call, and that was wrong: `VaultCleanup` clears
   * vaults on its own retry path, having deleted the vaults and nothing else.
   * Marking the runtime released there would have let a container whose destroy
   * failed lose the only row pointing at it, during ordinary failure recovery.
   */
  async clearVaults(id: string): Promise<void> {
    await this.db.update(sessions).set({ runtimeVaultIds: [] }).where(eq(sessions.id, id));
  }

  /**
   * The runtime is provably gone — `runner.destroy()` returned.
   *
   * This is what makes a row safe to delete. A terminal status does not: it is
   * written *before* the destroy is attempted, and `runtimeHandle` is kept
   * afterwards for the record, so neither can tell a released container from
   * one still running.
   */
  async markRuntimeReleased(id: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ runtimeReleasedAt: new Date() })
      .where(eq(sessions.id, id));
  }

  /** Finished sessions whose credential holders were never cleaned up. */
  sessionsWithPendingVaults(
    staleMinutes = 60,
    limit = 500,
    after: Date | null = null,
  ): Promise<SessionRow[]> {
    return pendingVaultQuery(this.db, staleMinutes, limit, after);
  }

  /**
   * Records the runtime this session is running on.
   *
   * `runtimeReleasedAt` is cleared, because attaching means a container exists
   * again. A session whose first backend was destroyed before falling back to
   * another would otherwise carry the first one's release stamp, and a later
   * failed destroy on the *second* container would read as already released.
   */
  async attachRuntime(
    id: string,
    runtimeHandle: string,
    traceUrl: string | null,
    runtimeVaultIds: string[] = [],
  ): Promise<void> {
    await this.db
      .update(sessions)
      .set({
        runtimeHandle,
        traceUrl,
        runtimeVaultIds,
        status: "running",
        runtimeReleasedAt: null,
      })
      .where(eq(sessions.id, id));
  }

  /**
   * A runtime that exists, could not be recorded, and could not be destroyed.
   *
   * The worst state the provisioner can reach. Writing the handle here is what
   * lets the delete guards refuse the row and the operator find the container;
   * without it there is a running container nothing in the system names.
   */
  async recordOrphanedRuntime(id: string, runtimeHandle: string, detail: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({
        runtimeHandle,
        runtimeReleasedAt: null,
        error: `runtime ${runtimeHandle} could not be recorded or destroyed: ${detail}`,
      })
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
      .set({ error: redactRegistered(`${existing}container was not destroyed: ${detail}`) })
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

  /**
   * Records commits this session produced (SPEC §6).
   *
   * A set, and ordered by first sighting: the same commit can arrive twice —
   * once because the agent reported it, once because the workspace was read
   * before it was destroyed — and the session row should show it once.
   */
  async recordCommits(id: string, shas: string[]): Promise<string[]> {
    const clean = shas.map((sha) => sha.trim().toLowerCase()).filter(Boolean);
    if (clean.length === 0) {
      return [];
    }
    const row = await this.require(id);
    const commitShas = [...new Set([...row.commitShas, ...clean])];
    if (commitShas.length === row.commitShas.length) {
      return row.commitShas;
    }
    await this.db.update(sessions).set({ commitShas }).where(eq(sessions.id, id));
    return commitShas;
  }

  /**
   * The outcome of the push the worker attempted before deleting the workspace.
   *
   * Written whole rather than merged: teardown asks once, the worker memoises
   * its answer, so a second call carries the same records rather than a partial
   * update to reconcile.
   */
  async recordPublish(id: string, publish: SessionPublish): Promise<void> {
    await this.db.update(sessions).set({ publish }).where(eq(sessions.id, id));
  }

  async finish(
    id: string,
    input: { status: Extract<SessionStatus, "destroyed" | "failed">; error?: string | null; costUsd?: number | null },
  ): Promise<void> {
    await this.db
      .update(sessions)
      .set({
        status: input.status,
        // The last gate before an error becomes a stored record. Auditing
        // every `String(error)` in the codebase is unwinnable — SDK errors
        // quote requests, wrappers quote wrappers — so the scrub happens where
        // the text stops being a variable and becomes a row.
        error: input.error === null || input.error === undefined
          ? null
          : redactRegistered(input.error),
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

  /**
   * Deletes a finished session's record.
   *
   * Refused while the session is still live. A session row is the only handle
   * the control plane has on a running container — the teardown path, the
   * orphan sweep and the cost record all find it by id — so deleting one
   * mid-run would leave a container nothing points at, billing, until the
   * sweep notices. Housekeeping is for runs that are over.
   *
   * Also refused while credentials are still out. Teardown marks a session
   * terminal *before* it destroys the runtime, and when that destruction fails
   * the row deliberately keeps its vault ids so the retry queue can find it
   * (`pending-vaults.ts`). A terminal status is therefore not the same as "the
   * container is gone and the vaults are revoked", and deleting such a row
   * throws away the only record that those credentials still exist.
   */
  async remove(id: string, force = false): Promise<void> {
    const row = await this.require(id);
    if (!isTerminalSessionStatus(row.status)) {
      throw new ConflictException(
        `session ${id} is ${row.status}. Wait for it to finish, or cancel it first — deleting it ` +
          "now would leave its container with nothing pointing at it.",
      );
    }
    // `force` is the operator saying they have checked the runtime themselves.
    // It exists because some rows can never satisfy the guard: sessions that
    // predate `runtime_released_at`, and provisioning that failed before the
    // handle was persisted. Refusing those forever is not safer than letting
    // the operator say what they know — as long as the guard says what is being
    // given up, and never passes silently.
    if (!force && (row.runtimeVaultIds ?? []).length > 0) {
      throw new ConflictException(
        `session ${id} still has ${row.runtimeVaultIds.length} credential vault(s) that could not ` +
          "be deleted. This row is what the cleanup retry finds them by. Delete it anyway with " +
          "?force=true only if you have revoked them yourself.",
      );
    }
    if (!force && row.runtimeHandle && !row.runtimeReleasedAt) {
      throw new ConflictException(
        `session ${id} has a terminal status but its runtime (${row.runtimeHandle}) was never ` +
          "confirmed destroyed — the status is written before the destroy is attempted, so this " +
          "row is still the only handle on that container. Check it, then delete it anyway with " +
          "?force=true.",
      );
    }
    if (force) {
      this.logger.warn(
        `session ${id} deleted with force: runtime ${row.runtimeHandle ?? "(none)"} and ` +
          `${(row.runtimeVaultIds ?? []).length} vault(s) were not confirmed released`,
      );
    }
    await this.db.delete(sessions).where(eq(sessions.id, id));
  }
}
