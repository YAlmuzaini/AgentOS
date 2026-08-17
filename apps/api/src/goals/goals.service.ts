import { type Database, goalDecisions, goals, sessions } from "@agentos/db";
import { TERMINAL_SESSION_STATUSES } from "@agentos/shared";
import {
  type ApproveDodInput,
  type CreateGoalInput,
  draftDefinitionOfDone,
  type GoalDto,
  type GoalStatus,
} from "@agentos/shared";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { and, desc, eq, notInArray, sql } from "drizzle-orm";
import { DATABASE } from "../db/db.module";
import { ProjectsService } from "../projects/projects.service";
import { PreflightService } from "../capabilities/preflight.service";
import { SessionQueue } from "../queue/session.queue";
import { GoalLeases, LEASE_MINUTES } from "./goal-leases";
import { checkRails, MAX_UNAVAILABLE_TURNS, type RailBreach } from "./goal-rails";
import { GoalRuns } from "./goal-runs";

export type { RailBreach };

export type GoalRow = typeof goals.$inferSelect;

export { LEASE_MINUTES };

@Injectable()
export class GoalsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly projects: ProjectsService,
    private readonly queue: SessionQueue,
    private readonly leases: GoalLeases,
    private readonly preflight: PreflightService,
    private readonly runs: GoalRuns,
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
    await this.preflight.assertReady(projectId, "goal", id, input.acknowledgePreflightWarnings);

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
    this.runs.cancel(id);
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
   * Stops an *active* goal, once.
   *
   * The claim is in the predicate, so two concurrent rail breaches cannot both
   * decide they were the one that stopped it — only the row-winner gets a
   * result back, and only the row-winner sends the notification. Returns null
   * when the goal was already stopped by somebody else.
   */
  async stopIfActive(id: string, status: GoalStatus, reason: string): Promise<GoalDto | null> {
    const [row] = await this.db
      .update(goals)
      .set({ status, stoppedReason: reason, updatedAt: new Date() })
      .where(and(eq(goals.id, id), eq(goals.status, "active")))
      .returning();
    return row ? toDto(row) : null;
  }

  /**
   * How many decision attempts in a row have found the worker unavailable.
   *
   * Counted from the durable audit rather than a new column: the evaluator
   * already writes one `goal_decisions` row per attempt, with `unavailable`
   * kept distinct from `failed`. Anything that is not `unavailable` — a
   * success, or a genuine decision failure — resets the count, because it
   * proves the worker answered.
   */
  async consecutiveUnavailableDecisions(goalId: string): Promise<number> {
    const rows = await this.db
      .select({ status: goalDecisions.status })
      .from(goalDecisions)
      .where(eq(goalDecisions.goalId, goalId))
      .orderBy(desc(goalDecisions.createdAt))
      .limit(MAX_UNAVAILABLE_TURNS + 1);
    let streak = 0;
    for (const row of rows) {
      if (row.status !== "unavailable") break;
      streak += 1;
    }
    return streak;
  }

  /** The safety rails (SPEC §11), evaluated in `goal-rails.ts`. */
  checkRails(goal: GoalRow): RailBreach | null {
    return checkRails(goal);
  }

  /** Delegated to `GoalLeases`, which the runner shares (see that file). */
  claimIteration(id: string, leaseMinutes = LEASE_MINUTES): Promise<string | null> {
    return this.leases.claim(id, leaseMinutes);
  }

  renewIteration(id: string, token: string): Promise<boolean> {
    return this.leases.renew(id, token);
  }

  releaseIteration(id: string, token: string): Promise<void> {
    return this.leases.release(id, token);
  }

  /**
   * Consumes one of the goal's iterations, before its container is created.
   *
   * Counted on the way *in* rather than the way out. Incrementing after the
   * session returned meant a worker that died mid-specialist had launched a
   * container without spending an iteration, so repeated crashes could start
   * far more of them than the ceiling permits — and each one could spend.
   */
  async reserveIteration(id: string, agentName: string): Promise<void> {
    await this.db
      .update(goals)
      .set({
        iterations: sql`${goals.iterations} + 1`,
        lastAgentName: agentName,
        updatedAt: new Date(),
      })
      .where(eq(goals.id, id));
  }

  /**
   * Records whether the finished turn moved the goal, and returns it as it now
   * stands.
   *
   * Incremented in SQL rather than read-then-written: two dispatches finishing
   * together would otherwise each write from the same starting value, and the
   * rails would undercount exactly when the loop is running hottest.
   */
  async recordProgress(id: string, madeProgress: boolean): Promise<GoalRow> {
    const [row] = await this.db
      .update(goals)
      .set({
        // Progress, and nothing else, resets this. It used to also reset
        // whenever the specialist differed from the last one, which meant two
        // agents alternating could circle forever without the rail ever
        // counting past one — and an orchestrator picking a different agent is
        // exactly what a stuck goal looks like.
        stuckCount: madeProgress ? 0 : sql`${goals.stuckCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(goals.id, id))
      .returning();
    return row!;
  }

  /**
   * Ticks the checklist items the evaluator judged satisfied.
   *
   * A newly ticked item is the strongest progress signal there is, so it bumps
   * the progress counter the stuck rail reads. Re-asserting an item that was
   * already done is not progress, which is why the count is of the transition
   * rather than of the evaluator's list.
   */
  async markSatisfied(id: string, satisfiedIds: string[]): Promise<GoalRow> {
    const goal = await this.requireById(id);
    let newlyDone = 0;
    const updated = goal.definitionOfDone.map((item) => {
      if (item.done || !satisfiedIds.includes(item.id)) {
        return item;
      }
      newlyDone += 1;
      return { ...item, done: true };
    });
    const [row] = await this.db
      .update(goals)
      .set({
        definitionOfDone: updated,
        ...(newlyDone > 0 ? { progressMarks: sql`${goals.progressMarks} + ${newlyDone}` } : {}),
        updatedAt: new Date(),
      })
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

  /** Whether this goal is still there. Checked immediately before a dispatch. */
  async exists(id: string): Promise<boolean> {
    const [row] = await this.db.select({ id: goals.id }).from(goals).where(eq(goals.id, id));
    return Boolean(row);
  }

  /**
   * Removes one goal.
   *
   * Refused while the goal is `active`, and while a session of its own is still
   * live.
   *
   * The status check is the load-bearing one. `sessions.goal_id` has no foreign
   * key, so those sessions do not "stop naming a goal" — they keep a uuid that
   * points at nothing. And checking only for *existing* live sessions leaves a
   * window: the orchestrator reads the goal, then creates the session, so a
   * delete landing between the two produces a container that runs, spends, and
   * fails at the end trying to update a goal that is gone. An active goal has
   * to be paused first, which stops the loop dispatching another iteration.
   *
   * Finished sessions keep their record and are left alone.
   */
  async remove(projectId: string, id: string): Promise<void> {
    const [row] = await this.db
      .select({ id: goals.id, status: goals.status })
      .from(goals)
      .where(and(eq(goals.projectId, projectId), eq(goals.id, id)));
    if (!row) {
      throw new NotFoundException(`goal ${id} not found`);
    }

    if (row.status === "active") {
      throw new ConflictException(
        "this goal is still active. Pause it first — its orchestrator may already be dispatching " +
          "the next specialist, and that session would run and spend against a goal that is gone.",
      );
    }

    const live = await this.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(
        and(
          eq(sessions.goalId, id),
          notInArray(sessions.status, [...TERMINAL_SESSION_STATUSES]),
        ),
      );
    if (live.length > 0) {
      throw new ConflictException(
        `this goal still has ${live.length} live session${live.length === 1 ? "" : "s"}. Pause it ` +
          "and let them finish, or the next orchestrator turn will fail looking for a goal that " +
          "is no longer there.",
      );
    }

    await this.db.delete(goals).where(eq(goals.id, id));
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
    startedAt: row.startedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
