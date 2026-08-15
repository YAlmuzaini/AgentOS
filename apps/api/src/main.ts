import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { APP_CONFIG, type AppConfig } from "./config/config";

async function bootstrap(): Promise<void> {
  // rawBody is what the webhook signature is computed over; a re-serialised
  // body would change the bytes and every signature would fail.
  const app = await NestFactory.create(AppModule, { bufferLogs: false, rawBody: true });
  const config = app.get<AppConfig>(APP_CONFIG);

  app.enableCors({ origin: config.WEB_ORIGIN, credentials: true });
  // Validation is per-route via the shared Zod contracts (ZodBody), so there is
  // no global class-validator pipe.
  app.enableShutdownHooks();

  await app.listen(config.API_PORT);
  new Logger("bootstrap").log(`AgentOS API listening on :${config.API_PORT}`);
}

bootstrap().catch((error) => {
  // Fail loud: a missing secret or an unreachable dependency must not start.
  console.error(error);
  process.exit(1);
});
