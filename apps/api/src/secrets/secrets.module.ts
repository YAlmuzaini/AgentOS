import { Module } from "@nestjs/common";
import { ProjectsModule } from "../projects/projects.module";
import { SecretsController } from "./secrets.controller";
import { EnvSecretsProvider, SECRETS_PROVIDER } from "./secrets.provider";
import { SecretsService } from "./secrets.service";

@Module({
  imports: [ProjectsModule],
  controllers: [SecretsController],
  providers: [
    // Swap this binding for the Secret Manager driver in production; nothing
    // above the interface changes.
    { provide: SECRETS_PROVIDER, useClass: EnvSecretsProvider },
    SecretsService,
  ],
  exports: [SecretsService, SECRETS_PROVIDER],
})
export class SecretsModule {}
