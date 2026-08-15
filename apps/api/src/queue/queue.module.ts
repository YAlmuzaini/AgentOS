import { Global, Module } from "@nestjs/common";
import IORedis from "ioredis";
import { APP_CONFIG, type AppConfig } from "../config/config";
import { SessionQueue } from "./session.queue";
import { REDIS } from "./tokens";

export { REDIS };

/**
 * Producer side only. The consumer (session orchestrator) lives in
 * RunnerModule so this module stays free of domain dependencies and the
 * controllers that enqueue work do not pull the runner into their graph.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        // BullMQ requires this to be null, not the ioredis default of 20.
        new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null }),
    },
    SessionQueue,
  ],
  exports: [REDIS, SessionQueue],
})
export class QueueModule {}
