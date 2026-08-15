import { type Database, goals } from "@agentos/db";
import { Global, Inject, Injectable, Module } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { DATABASE } from "../db/db.module";
import { GoalLeases } from "./goal-leases";

/**
 * Append-only writes to a goal's shared state.
 *
 * Deliberately tiny and dependency-free: the runner needs to write progress
 * and spend without importing the goal orchestrator, and the orchestrator
 * needs to read them without importing the runner.
 */
@Injectable()
export class GoalLogService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Appends one timestamped line to the goal's shared progress log.
   *
   * `marksProgress` is what the stuck rail counts, and it is deliberately not
   * the same thing as "a line was written". An agent's own summary, the
   * orchestrator's dispatch line and a failure notice all land in this log;
   * none of them is evidence that the goal moved. Only an agent explicitly
   * recording work — and a checklist item flipping to done, elsewhere — does.
   */
  async appendProgress(
    goalId: string,
    author: string,
    body: string,
    options: { marksProgress?: boolean } = {},
  ): Promise<void> {
    const entry = `\n[${new Date().toISOString()}] ${author}: ${body.trim()}`;
    await this.db
      .update(goals)
      .set({
        progressLog: sql`${goals.progressLog} || ${entry}`,
        ...(options.marksProgress
          ? { progressMarks: sql`${goals.progressMarks} + 1` }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(goals.id, goalId));
  }

  /**
   * The goal's time rail, for a session that needs to honour it.
   *
   * Here rather than on `GoalsService` so the runner can read it without
   * importing the goals module, which imports the runner.
   */
  async timeRail(goalId: string): Promise<{ startedAt: Date | null; maxDurationMinutes: number | null } | null> {
    const [row] = await this.db
      .select({ startedAt: goals.startedAt, maxDurationMinutes: goals.maxDurationMinutes })
      .from(goals)
      .where(eq(goals.id, goalId))
      .limit(1);
    return row ?? null;
  }

  /** Accumulates spend so the cap is checked against reality, not estimates. */
  async recordSpend(goalId: string, usd: number): Promise<void> {
    if (usd <= 0) {
      return;
    }
    await this.db
      .update(goals)
      .set({
        spendUsd: sql`${goals.spendUsd} + ${usd.toFixed(4)}`,
        updatedAt: new Date(),
      })
      .where(eq(goals.id, goalId));
  }
}

@Global()
@Module({
  providers: [GoalLogService, GoalLeases],
  exports: [GoalLogService, GoalLeases],
})
export class GoalLogModule {}
