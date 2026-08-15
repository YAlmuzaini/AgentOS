import { Module } from "@nestjs/common";
import { ProjectsModule } from "../projects/projects.module";
import { QueueModule } from "../queue/queue.module";
import { RunnerModule } from "../runner/runner.module";
import { GOAL_EVALUATOR, ModelGoalEvaluator } from "./goal-evaluator";
import { GoalOrchestrator } from "./goal-orchestrator";
import { GoalsController } from "./goals.controller";
import { GoalsService } from "./goals.service";

/**
 * Depends on the runner, never the other way round: the runner runs one
 * session and knows nothing about loops.
 */
@Module({
  imports: [ProjectsModule, QueueModule, RunnerModule],
  controllers: [GoalsController],
  providers: [
    GoalsService,
    GoalOrchestrator,
    { provide: GOAL_EVALUATOR, useClass: ModelGoalEvaluator },
  ],
  exports: [GoalsService, GoalOrchestrator],
})
export class GoalsModule {}
