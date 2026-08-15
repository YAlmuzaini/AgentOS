import { Module } from "@nestjs/common";
import { AgentsModule } from "../agents/agents.module";
import { ProjectsModule } from "../projects/projects.module";
import { QueueModule } from "../queue/queue.module";
import { TasksModule } from "../tasks/tasks.module";
import { TemplatesModule } from "../templates/templates.module";
import { AutomationsController } from "./automations.controller";
import { AutomationsService } from "./automations.service";

@Module({
  imports: [ProjectsModule, AgentsModule, TasksModule, TemplatesModule, QueueModule],
  controllers: [AutomationsController],
  providers: [AutomationsService],
  exports: [AutomationsService],
})
export class AutomationsModule {}
