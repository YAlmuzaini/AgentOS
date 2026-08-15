import { createDatabase, type Database } from "@agentos/db";
import { Global, Module } from "@nestjs/common";
import { APP_CONFIG, type AppConfig, loadConfig } from "../config/config";

export const DATABASE = Symbol("DATABASE");

@Global()
@Module({
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: (): AppConfig => loadConfig(),
    },
    {
      provide: DATABASE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): Database => createDatabase({ url: config.DATABASE_URL }),
    },
  ],
  exports: [APP_CONFIG, DATABASE],
})
export class DbModule {}
