import { type Database, goals } from "@agentos/db";
import { Global, Inject, Injectable, Module } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { DATABASE } from "../db/db.module";

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

  /** Appends one timestamped line to the goal's shared progress log. */
  async appendProgress(goalId: string, author: string, body: string): Promise<void> {
    const entry = `\n[${new Date().toISOString()}] ${author}: ${body.trim()}`;
    await this.db
      .update(goals)
      .set({
        progressLog: sql`${goals.progressLog} || ${entry}`,
        updatedAt: new Date(),
      })
      .where(eq(goals.id, goalId));
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
  providers: [GoalLogService],
  exports: [GoalLogService],
})
export class GoalLogModule {}
