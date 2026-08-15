import { Module } from "@nestjs/common";
import { AgentsModule } from "../agents/agents.module";
import { ProjectsModule } from "../projects/projects.module";
import { QueueModule } from "../queue/queue.module";
import { TasksController } from "./tasks.controller";
import { ChainRecovery } from "./chain-recovery";
import { TasksService } from "./tasks.service";

@Module({
  imports: [ProjectsModule, AgentsModule, QueueModule],
  controllers: [TasksController],
  providers: [ChainRecovery, TasksService],
  exports: [ChainRecovery, TasksService],
})
export class TasksModule {}
