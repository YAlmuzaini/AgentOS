import { Module } from "@nestjs/common";
import { AgentsModule } from "../agents/agents.module";
import { ProjectsModule } from "../projects/projects.module";
import { ResourcesModule } from "../resources/resources.module";
import { TemplatesModule } from "../templates/templates.module";
import { CompanyController } from "./company.controller";
import { CompanyService } from "./company.service";

@Module({
  imports: [ProjectsModule, AgentsModule, ResourcesModule, TemplatesModule],
  controllers: [CompanyController],
  providers: [CompanyService],
  exports: [CompanyService],
})
export class CompanyModule {}
