import { Logger } from "@nestjs/common";
import * as Sentry from "@sentry/node";
import type { ErrorContext, ErrorReporter } from "./error-reporter";
import { describe } from "./error-reporter";
import { scrubEvent } from "./scrub";

/**
 * Ships failures to GlitchTip (RECIPE A8), which speaks the Sentry protocol.
 *
 * Selected only when a DSN is configured, so development and a fresh install
 * keep the log driver and no error ever leaves the machine by default.
 *
 * Tracing and profiling are off deliberately. This is a single-operator control
 * plane; the value here is "tell me the runner broke while I was asleep", not
 * span waterfalls, and every span would carry more text to scrub.
 */
export class GlitchTipReporter implements ErrorReporter {
  readonly name = "glitchtip";

  private readonly logger = new Logger("ErrorReporter");

  constructor(dsn: string, environment: string, release?: string) {
    Sentry.init({
      dsn,
      environment,
      release,
      tracesSampleRate: 0,
      // Default integrations pull in request bodies and local variables; both
      // carry exactly the text this app must not ship.
      defaultIntegrations: false,
      integrations: [],
      sendDefaultPii: false,
      // The last gate before anything leaves the process. Every event and every
      // breadcrumb goes through the same scrubbing.
      beforeSend: (event) => scrubEvent(event),
      beforeBreadcrumb: (breadcrumb) => scrubEvent(breadcrumb),
    });
    this.logger.log(`errors report to GlitchTip (${environment})`);
  }

  capture(error: unknown, context?: ErrorContext): void {
    Sentry.withScope((scope) => {
      if (context?.scope) {
        scope.setTag("scope", context.scope);
        scope.setFingerprint(["{{ default }}", context.scope]);
      }
      for (const [key, value] of Object.entries(context?.tags ?? {})) {
        if (value !== undefined && value !== null) {
          scope.setTag(key, String(value));
        }
      }
      // A thrown non-Error still has to arrive as something greppable.
      if (error instanceof Error) {
        Sentry.captureException(error);
      } else {
        Sentry.captureMessage(describe(error), "error");
      }
    });
  }

  async flush(timeoutMs = 2_000): Promise<void> {
    await Sentry.flush(timeoutMs);
  }
}
