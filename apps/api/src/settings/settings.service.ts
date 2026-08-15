import { type Database, projects, projectSettings } from "@agentos/db";
import { DEFAULT_SETTINGS, type SettingsDto, type UpdateSettingsInput } from "@agentos/shared";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DATABASE } from "../db/db.module";
import { ProjectsService } from "../projects/projects.service";
import { SessionQueue } from "../queue/session.queue";

/**
 * Reads and writes operator policy (SPEC §18).
 *
 * A project that has never saved settings reads as the defaults rather than as
 * an error, so nothing in the system has to special-case their absence.
 */
@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly projects: ProjectsService,
    private readonly queue: SessionQueue,
  ) {}

  async get(projectId: string): Promise<SettingsDto> {
    await this.projects.require(projectId);
    return this.read(projectId);
  }

  /** The read the maintenance job uses: no project check, no exception. */
  async read(projectId: string): Promise<SettingsDto> {
    const row = await this.db.query.projectSettings.findFirst({
      where: eq(projectSettings.projectId, projectId),
    });
    if (!row) {
      return { projectId, ...DEFAULT_SETTINGS, updatedAt: null };
    }
    return {
      projectId: row.projectId,
      parkedSessionTimeoutMinutes: row.parkedSessionTimeoutMinutes,
      orphanSweepEnabled: row.orphanSweepEnabled,
      orphanSweepIntervalMinutes: row.orphanSweepIntervalMinutes,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /**
   * Projects that want the orphan sweep. A project with no settings row counts
   * as wanting it, because the default is on — which is why this cannot be a
   * plain `where enabled = true`.
   */
  async projectsWithSweepEnabled(): Promise<string[]> {
    const all = await this.db.select({ id: projects.id }).from(projects);
    const rows = await this.db.select().from(projectSettings);
    const disabled = new Set(
      rows.filter((row) => !row.orphanSweepEnabled).map((row) => row.projectId),
    );
    return all.map((row) => row.id).filter((id) => !disabled.has(id));
  }

  /** How many projects exist, for the sweep's "is anyone opted out" question. */
  async projectCount(): Promise<number> {
    return (await this.db.select({ id: projects.id }).from(projects)).length;
  }

  /**
   * The cadence the maintenance heartbeat runs at: the shortest any project
   * asks for, since one schedule serves every project and a pass is cheap.
   */
  async shortestSweepInterval(): Promise<number> {
    const rows = await this.db.select().from(projectSettings);
    return rows.reduce(
      (shortest, row) => Math.min(shortest, row.orphanSweepIntervalMinutes),
      DEFAULT_SETTINGS.orphanSweepIntervalMinutes,
    );
  }

  async update(projectId: string, input: UpdateSettingsInput): Promise<SettingsDto> {
    await this.projects.require(projectId);
    const [row] = await this.db
      .insert(projectSettings)
      .values({ projectId, ...input, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: projectSettings.projectId,
        set: { ...input, updatedAt: new Date() },
      })
      .returning();

    // The heartbeat is installed once at boot, so a cadence change has to
    // reschedule it here or the UI reports a policy that is not running.
    await this.queue
      .scheduleMaintenance(await this.shortestSweepInterval())
      .catch((error: unknown) =>
        this.logger.error(`settings saved but the maintenance schedule did not move: ${String(error)}`),
      );

    // Worth a log line: these change how long containers live and how
    // aggressively they are reclaimed.
    this.logger.log(
      `settings for ${projectId}: parked timeout ${input.parkedSessionTimeoutMinutes}m, ` +
        `sweep ${input.orphanSweepEnabled ? `every ${input.orphanSweepIntervalMinutes}m` : "off"}`,
    );

    return {
      projectId: row!.projectId,
      parkedSessionTimeoutMinutes: row!.parkedSessionTimeoutMinutes,
      orphanSweepEnabled: row!.orphanSweepEnabled,
      orphanSweepIntervalMinutes: row!.orphanSweepIntervalMinutes,
      updatedAt: row!.updatedAt.toISOString(),
    };
  }
}
