import { Module } from "@nestjs/common";
import { AgentsModule } from "../agents/agents.module";
import { ProjectsModule } from "../projects/projects.module";
import { TasksModule } from "../tasks/tasks.module";
import { TriggersController, WebhookController } from "./triggers.controller";
import { DeliveryHandler } from "./delivery-handler";
import { TriggersService } from "./triggers.service";

@Module({
  imports: [ProjectsModule, AgentsModule, TasksModule],
  controllers: [TriggersController, WebhookController],
  providers: [DeliveryHandler, TriggersService],
  exports: [TriggersService],
})
export class TriggersModule {}
