import { Module } from "@nestjs/common";
import { APP_CONFIG, type AppConfig } from "../config/config";
import { ProjectsModule } from "../projects/projects.module";
import { GoogleSecretManagerProvider } from "./google-secrets.provider";
import { SecretsController } from "./secrets.controller";
import { EnvSecretsProvider, SECRETS_PROVIDER } from "./secrets.provider";
import { SecretsService } from "./secrets.service";

@Module({
  imports: [ProjectsModule],
  controllers: [SecretsController],
  providers: [
    // One binding, two drivers, chosen by configuration (RECIPE A2). Nothing
    // above the interface knows which one answered.
    {
      provide: SECRETS_PROVIDER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        config.SECRETS_PROVIDER === "gcp"
          ? new GoogleSecretManagerProvider(config)
          : new EnvSecretsProvider(),
    },
    SecretsService,
  ],
  exports: [SecretsService, SECRETS_PROVIDER],
})
export class SecretsModule {}
