import { Module } from "@nestjs/common";
import { ProjectsModule } from "../projects/projects.module";
// For DeletionService: removing an agent also strips it from other agents'
// collaboration lists, and refuses when sessions reference it.
import { ResourcesModule } from "../resources/resources.module";
import { AgentsController } from "./agents.controller";
import { AgentsService } from "./agents.service";

@Module({
  imports: [ProjectsModule, ResourcesModule],
  controllers: [AgentsController],
  providers: [AgentsService],
  exports: [AgentsService],
})
export class AgentsModule {}
