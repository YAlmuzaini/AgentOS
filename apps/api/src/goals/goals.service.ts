import { type Database, goals } from "@agentos/db";
import {
  type ApproveDodInput,
  type CreateGoalInput,
  draftDefinitionOfDone,
  type GoalDto,
  type GoalStatus,
} from "@agentos/shared";
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { DATABASE } from "../db/db.module";
import { ProjectsService } from "../projects/projects.service";
import { SessionQueue } from "../queue/session.queue";

export type GoalRow = typeof goals.$inferSelect;

/** Why the loop stopped, or null when it may keep going. */
export type RailBreach =
  | { status: "stopped-spend"; reason: string }
  | { status: "stopped-time"; reason: string }
  | { status: "stopped-stuck"; reason: string };

@Injectable()
export class GoalsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly projects: ProjectsService,
    private readonly queue: SessionQueue,
  ) {}

  async list(projectId: string): Promise<GoalDto[]> {
    await this.projects.require(projectId);
    const rows = await this.db
      .select()
      .from(goals)
      .where(eq(goals.projectId, projectId))
      .orderBy(desc(goals.createdAt));
    return rows.map(toDto);
  }

  async get(projectId: string, id: string): Promise<GoalDto> {
    return toDto(await this.require(projectId, id));
  }

  /**
   * Creates the goal in `draft`. The checklist is drafted from the spec when
   * the operator did not write one, but nothing runs until they approve it.
   */
  async create(projectId: string, input: CreateGoalInput): Promise<GoalDto> {
    await this.projects.require(projectId);

    const texts =
      input.definitionOfDone.length > 0
        ? input.definitionOfDone
        : draftDefinitionOfDone(input.spec);
    if (texts.length === 0) {
      throw new BadRequestException(
        "could not draft a definition of done from this spec — write the checklist yourself",
      );
    }

    const [row] = await this.db
      .insert(goals)
      .values({
        projectId,
        title: input.title,
        spec: input.spec,
        definitionOfDone: texts.map((text) => ({ id: randomUUID(), text, done: false })),
        spendCapUsd: input.spendCapUsd === null ? null : input.spendCapUsd.toFixed(4),
        maxDurationMinutes: input.maxDurationMinutes,
        stuckThreshold: input.stuckThreshold,
        runnerPreference: input.runnerPreference,
        status: "draft",
      })
      .returning();
    return toDto(row!);
  }

  /** The operator's sign-off. This is what starts the loop (SPEC §11.3). */
  async approveDod(projectId: string, id: string, input: ApproveDodInput): Promise<GoalDto> {
    const goal = await this.require(projectId, id);
    if (goal.dodApproved) {
      throw new BadRequestException("this goal's definition of done is already approved");
    }

    const [row] = await this.db
      .update(goals)
      .set({
        definitionOfDone: input.definitionOfDone,
        dodApproved: true,
        status: "active",
        startedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(goals.id, id))
      .returning();

    await this.queue.enqueueGoalIteration(id);
    return toDto(row!);
  }

  async pause(projectId: string, id: string): Promise<GoalDto> {
    const goal = await this.require(projectId, id);
    if (goal.status !== "active") {
      throw new BadRequestException(`goal is ${goal.status}, not active`);
    }
    return this.setStatus(id, "paused", null);
  }

  async resume(projectId: string, id: string): Promise<GoalDto> {
    const goal = await this.require(projectId, id);
    if (goal.status !== "paused") {
      throw new BadRequestException(`goal is ${goal.status}, not paused`);
    }
    const resumed = await this.setStatus(id, "active", null);
    await this.queue.enqueueGoalIteration(id);
    return resumed;
  }

  async setStatus(id: string, status: GoalStatus, reason: string | null): Promise<GoalDto> {
    const [row] = await this.db
      .update(goals)
      .set({ status, stoppedReason: reason, updatedAt: new Date() })
      .where(eq(goals.id, id))
      .returning();
    return toDto(row!);
  }

  /**
   * The safety rails (SPEC §11). Checked before every dispatch, so a goal can
   * never spend or run past them by one more session.
   */
  checkRails(goal: GoalRow): RailBreach | null {
    const cap = goal.spendCapUsd === null ? null : Number(goal.spendCapUsd);
    const spent = Number(goal.spendUsd);
    if (cap !== null && spent >= cap) {
      return {
        status: "stopped-spend",
        reason: `spend cap reached: $${spent.toFixed(2)} of $${cap.toFixed(2)}`,
      };
    }

    if (goal.maxDurationMinutes !== null && goal.startedAt) {
      const elapsedMinutes = (Date.now() - goal.startedAt.getTime()) / 60_000;
      if (elapsedMinutes >= goal.maxDurationMinutes) {
        return {
          status: "stopped-time",
          reason: `max duration reached: ${Math.round(elapsedMinutes)} of ${goal.maxDurationMinutes} minutes`,
        };
      }
    }

    if (goal.stuckCount >= goal.stuckThreshold) {
      return {
        status: "stopped-stuck",
        reason: `no progress across ${goal.stuckCount} iterations`,
      };
    }

    return null;
  }

  /**
   * Records one completed iteration, and returns the goal as it now stands.
   *
   * The counters are incremented in SQL rather than read-then-written: two
   * dispatches finishing together would otherwise each write `iterations + 1`
   * from the same starting value, and the rails would undercount exactly when
   * the loop is running hottest. The stuck decision still needs the previous
   * agent name, so it is taken from the same statement's view of the row.
   */
  /**
   * Takes the goal's single dispatch slot.
   *
   * A goal is a spend cap with a loop attached, and two loops running against
   * one cap each see the same remaining budget and can each spend all of it.
   * The lease is what makes "one specialist at a time" true regardless of how
   * many iteration jobs exist — duplicates simply lose and exit.
   *
   * The lease expires so a worker that dies mid-dispatch does not freeze the
   * goal forever; it is deliberately longer than any single session should run.
   */
  async claimIteration(id: string, leaseMinutes = 60): Promise<boolean> {
    const cutoff = new Date(Date.now() - leaseMinutes * 60_000);
    const rows = await this.db
      .update(goals)
      .set({ dispatchLeaseAt: new Date() })
      .where(
        and(
          eq(goals.id, id),
          or(isNull(goals.dispatchLeaseAt), lt(goals.dispatchLeaseAt, cutoff)),
        ),
      )
      .returning({ id: goals.id });
    return rows.length > 0;
  }

  /** Releases the slot so the next queued iteration can run immediately. */
  async releaseIteration(id: string): Promise<void> {
    await this.db.update(goals).set({ dispatchLeaseAt: null }).where(eq(goals.id, id));
  }

  async recordIteration(
    id: string,
    input: { agentName: string; madeProgress: boolean },
  ): Promise<GoalRow> {
    const [row] = await this.db
      .update(goals)
      .set({
        iterations: sql`${goals.iterations} + 1`,
        stuckCount: input.madeProgress
          ? 0
          : sql`CASE WHEN ${goals.lastAgentName} = ${input.agentName} THEN ${goals.stuckCount} + 1 ELSE 0 END`,
        lastAgentName: input.agentName,
        updatedAt: new Date(),
      })
      .where(eq(goals.id, id))
      .returning();
    return row!;
  }

  async markSatisfied(id: string, satisfiedIds: string[]): Promise<GoalRow> {
    const goal = await this.requireById(id);
    const updated = goal.definitionOfDone.map((item) =>
      satisfiedIds.includes(item.id) ? { ...item, done: true } : item,
    );
    const [row] = await this.db
      .update(goals)
      .set({ definitionOfDone: updated, updatedAt: new Date() })
      .where(eq(goals.id, id))
      .returning();
    return row!;
  }

  async require(projectId: string, id: string): Promise<GoalRow> {
    const row = await this.db.query.goals.findFirst({
      where: and(eq(goals.projectId, projectId), eq(goals.id, id)),
    });
    if (!row) {
      throw new NotFoundException(`goal ${id} not found`);
    }
    return row;
  }

  async requireById(id: string): Promise<GoalRow> {
    const row = await this.db.query.goals.findFirst({ where: eq(goals.id, id) });
    if (!row) {
      throw new NotFoundException(`goal ${id} not found`);
    }
    return row;
  }
}

export function toDto(row: GoalRow): GoalDto {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    spec: row.spec,
    definitionOfDone: row.definitionOfDone,
    dodApproved: row.dodApproved,
    status: row.status as GoalDto["status"],
    spendCapUsd: row.spendCapUsd === null ? null : Number(row.spendCapUsd),
    spendUsd: Number(row.spendUsd),
    maxDurationMinutes: row.maxDurationMinutes,
    stuckThreshold: row.stuckThreshold,
    runnerPreference: row.runnerPreference as GoalDto["runnerPreference"],
    progressLog: row.progressLog,
    stoppedReason: row.stoppedReason,
    iterations: row.iterations,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
