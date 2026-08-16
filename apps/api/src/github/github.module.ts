import { Module } from "@nestjs/common";
import { ProjectsModule } from "../projects/projects.module";
import { SecretsModule } from "../secrets/secrets.module";
import { GithubAppService } from "./github-app.service";
import { GithubCallbackController, GithubController } from "./github.controller";
import { GithubService } from "./github.service";

@Module({
  imports: [ProjectsModule, SecretsModule],
  controllers: [GithubController, GithubCallbackController],
  providers: [GithubAppService, GithubService],
  exports: [GithubService, GithubAppService],
})
export class GithubModule {}
