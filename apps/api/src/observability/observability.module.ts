import { Global, Module, type OnApplicationShutdown, Inject, Injectable } from "@nestjs/common";
import { APP_CONFIG, type AppConfig } from "../config/config";
import { ERROR_REPORTER, type ErrorReporter, LogErrorReporter } from "./error-reporter";
import { GlitchTipReporter } from "./glitchtip-reporter";

/**
 * Flushes buffered reports before the process goes away.
 *
 * The failures worth reporting most are the ones that happen while a container
 * is being torn down or a deploy is replacing the process, which is exactly
 * when an unflushed buffer is lost.
 */
@Injectable()
class ReporterShutdown implements OnApplicationShutdown {
  constructor(@Inject(ERROR_REPORTER) private readonly reporter: ErrorReporter) {}

  async onApplicationShutdown(): Promise<void> {
    await this.reporter.flush().catch(() => {
      // Shutdown is not the place to throw about telemetry.
    });
  }
}

/**
 * Error reporting, global because a failure can happen anywhere.
 *
 * The driver is chosen by whether a DSN exists, not by `NODE_ENV`: an operator
 * who wants reports from their laptop gets them by setting the DSN, and one who
 * deploys without configuring GlitchTip still gets structured logs rather than
 * a crash on boot.
 */
@Global()
@Module({
  providers: [
    {
      provide: ERROR_REPORTER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): ErrorReporter =>
        config.GLITCHTIP_DSN
          ? new GlitchTipReporter(config.GLITCHTIP_DSN, config.DEPLOY_ENV, config.RELEASE || undefined)
          : new LogErrorReporter(),
    },
    ReporterShutdown,
  ],
  exports: [ERROR_REPORTER],
})
export class ObservabilityModule {}
