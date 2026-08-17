import { Module } from "@nestjs/common";
import { GithubModule } from "../github/github.module";
import { ProjectsModule } from "../projects/projects.module";
import { SecretsModule } from "../secrets/secrets.module";
import { CatalogService } from "./catalog.service";
import { DeletionService } from "./deletion.service";
import { EnvironmentsService } from "./environments.service";
import { McpVerifier } from "./mcp-verifier";
import { ResourcesController } from "./resources.controller";

@Module({
  imports: [ProjectsModule, SecretsModule, GithubModule],
  controllers: [ResourcesController],
  providers: [EnvironmentsService, McpVerifier, CatalogService, DeletionService],
  exports: [EnvironmentsService, CatalogService, DeletionService],
})
export class ResourcesModule {}
