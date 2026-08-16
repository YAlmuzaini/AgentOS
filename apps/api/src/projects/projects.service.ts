import { agents, automations, type Database, projects, sessions } from "@agentos/db";
import { TERMINAL_SESSION_STATUSES } from "@agentos/shared";
import type { CreateProjectInput, ProjectDto, UpdateProjectInput } from "@agentos/shared";
import { ConflictException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { and, eq, isNotNull, isNull, notInArray, or, sql } from "drizzle-orm";
import { DATABASE } from "../db/db.module";
import { FilesService } from "../files/files.service";
import { SessionQueue } from "../queue/session.queue";

type ProjectRow = typeof projects.$inferSelect;

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly files: FilesService,
    private readonly queue: SessionQueue,
  ) {}

  async list(): Promise<ProjectDto[]> {
    const rows = await this.db.select().from(projects).orderBy(projects.createdAt);
    return rows.map(toDto);
  }

  async create(input: CreateProjectInput): Promise<ProjectDto> {
    const existing = await this.db.query.projects.findFirst({
      where: eq(projects.slug, input.slug),
    });
    if (existing) {
      throw new ConflictException(`project slug "${input.slug}" already exists`);
    }
    const [row] = await this.db.insert(projects).values(input).returning();
    return toDto(row!);
  }

  async get(id: string): Promise<ProjectDto> {
    return toDto(await this.require(id));
  }

  async update(id: string, input: UpdateProjectInput): Promise<ProjectDto> {
    await this.require(id);
    const [row] = await this.db
      .update(projects)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(projects.id, id))
      .returning();
    return toDto(row!);
  }

  /** Shared existence check so every route 404s consistently. */
  async require(id: string): Promise<ProjectRow> {
    const row = await this.db.query.projects.findFirst({ where: eq(projects.id, id) });
    if (!row) {
      throw new NotFoundException(`project ${id} not found`);
    }
    return row;
  }

  /**
   * Deletes a project and everything in it.
   *
   * **It refuses while anything is unfinished.** A session row is the only
   * handle the control plane has on a running container: its runtime id, its
   * vault ids, the sweep that would reclaim it. Deleting the project deletes
   * that handle, and the orphan sweep then skips the container because the
   * project it would check is gone — so the run survives its own record, still
   * billing and still acting. "Unfinished" also covers a terminal session that
   * still holds vault ids: teardown marks a session terminal *before* it
   * destroys the runtime, and a failed destroy deliberately keeps those ids so
   * the retry queue can find them.
   *
   * **The check is re-run inside the transaction, against a locked project
   * row.** Checking first and deleting afterwards left a window in which a
   * queued worker started a session between the two, and the delete then
   * removed its row while it was provisioning.
   *
   * **Automation schedules are cancelled before the rows go.** Those live in
   * Redis, not Postgres, so a cascade leaves them to fire at their next
   * occurrence against a project that no longer exists.
   *
   * **Stored objects go before the rows do.** `file_objects` cascades, but a
   * cascade removes the index and leaves the bytes in R2, unreachable and still
   * charged, while the dialog promises every file is gone. An object written
   * between enumeration and deletion is still orphaned — storage is not part of
   * the transaction and cannot be — which is why a failure here is logged
   * loudly rather than swallowed.
   *
   * **Sessions and agents are deleted explicitly, in that order.** Everything
   * cascades from `projects`, but `sessions.agent_id` is `RESTRICT` and
   * Postgres promises no order between two cascade paths, so a cascade that
   * reaches `agents` first trips it.
   */
  async remove(id: string): Promise<void> {
    await this.require(id);
    await this.assertNothingUnfinished(id);

    for (const row of await this.db
      .select({ id: automations.id })
      .from(automations)
      .where(eq(automations.projectId, id))) {
      await this.queue.cancelAutomation(row.id);
    }

    // Read before the rows go, used after they do.
    const keys = await this.files.bucketKeysForProject(id);

    await this.db.transaction(async (tx) => {
      // Locks the project row, so a session created by a worker between the
      // check above and this transaction is either visible here or blocked
      // behind it.
      await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, id)).for("update");
      await this.assertNothingUnfinished(id, tx);

      await tx.delete(sessions).where(eq(sessions.projectId, id));
      await tx.delete(agents).where(eq(agents.projectId, id));
      await tx.delete(projects).where(eq(projects.id, id));
    });

    // Only once the rows are committed. Removing the bytes first meant a locked
    // recheck that correctly *refused* the deletion had already destroyed the
    // project's files — a refusal that lost data, which is worse than either
    // outcome it was choosing between. Storage is not transactional, so the
    // remaining exposure is the opposite and far milder one: rows gone, a few
    // objects possibly left behind, said out loud.
    const files = await this.files.removeAllForProject(keys);
    if (files.failed > 0) {
      this.logger.error(
        `project ${id}: ${files.failed} stored object(s) could not be removed and are now orphaned in the bucket`,
      );
    }
  }

  /**
   * Live sessions, or finished ones whose credentials are still out.
   *
   * Takes the executor rather than the database so it can run both before the
   * transaction and again inside it, against the locked row.
   */
  private async assertNothingUnfinished(
    id: string,
    db: Pick<Database, "select"> = this.db,
  ): Promise<void> {
    const live = await db
      .select({ status: sessions.status })
      .from(sessions)
      .where(
        and(
          eq(sessions.projectId, id),
          notInArray(sessions.status, [...TERMINAL_SESSION_STATUSES]),
        ),
      );
    if (live.length > 0) {
      throw new ConflictException(
        `${live.length} session${live.length === 1 ? " is" : "s are"} still live in this project ` +
          `(${[...new Set(live.map((row) => row.status))].join(", ")}). Deleting it now would ` +
          "leave those containers running with nothing pointing at them. Wait for them to finish, " +
          "or cancel them first.",
      );
    }

    const [stranded] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(sessions)
      .where(
        and(
          eq(sessions.projectId, id),
          or(
            sql`jsonb_array_length(${sessions.runtimeVaultIds}) > 0`,
            // Terminal but never confirmed destroyed: the status is written
            // before the destroy is attempted, so this row is still the only
            // handle on that container.
            and(isNotNull(sessions.runtimeHandle), isNull(sessions.runtimeReleasedAt)),
          ),
        ),
      );
    if ((stranded?.count ?? 0) > 0) {
      throw new ConflictException(
        `${stranded!.count} session(s) in this project still hold a runtime or credentials that ` +
          "were never confirmed released. Those rows are how the cleanup retry finds them; " +
          "deleting the project now would leave them with nothing pointing at them.",
      );
    }
  }

}

function toDto(row: ProjectRow): ProjectDto {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
