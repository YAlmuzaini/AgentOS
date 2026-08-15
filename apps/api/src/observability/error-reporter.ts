import { Injectable, Logger } from "@nestjs/common";

export const ERROR_REPORTER = Symbol("ERROR_REPORTER");

/**
 * Where a failure goes when nobody is watching the terminal.
 *
 * This exists because of two real incidents. A broken orphan sweep sent the
 * wrong shape to the runtime API and logged a 400 on every pass — it would have
 * reported zero orphans forever. And six abandoned workspaces sat on a disk for
 * days because a destroy failure only ever reached a log line. Both were found
 * by accident. The whole premise of this product is leaving it running while
 * you are not looking, so a failure that only reaches stdout is a failure that
 * did not happen.
 *
 * An interface rather than a direct SDK call (RECIPE A2): the log driver is the
 * default and the development experience, and GlitchTip plugs in behind it
 * without anything above this line knowing.
 */
export interface ErrorReporter {
  readonly name: string;
  /**
   * Reports a failure that has already been handled. `context` is metadata for
   * grouping and triage — never a secret, never a payload.
   */
  capture(error: unknown, context?: ErrorContext): void;
  /** Flushes anything buffered. Called on shutdown so a crash still reports. */
  flush(timeoutMs?: number): Promise<void>;
}

export interface ErrorContext {
  /** Coarse grouping, e.g. `maintenance.orphan-sweep`, `worker.job`. */
  scope: string;
  /** Small, non-sensitive key/values: ids, counts, statuses. */
  tags?: Record<string, string | number | null | undefined>;
}

/**
 * The default driver: structured logging, no network.
 *
 * Deliberately not a no-op. An operator who never configures GlitchTip should
 * still get every one of these in one recognisable shape, so `grep` is a
 * working fallback rather than nothing at all.
 */
@Injectable()
export class LogErrorReporter implements ErrorReporter {
  readonly name = "log";

  private readonly logger = new Logger("ErrorReporter");

  capture(error: unknown, context?: ErrorContext): void {
    const scope = context?.scope ?? "unknown";
    const tags = context?.tags ? ` ${formatTags(context.tags)}` : "";
    this.logger.error(`[${scope}]${tags} ${describe(error)}`);
  }

  async flush(): Promise<void> {
    // Nothing is buffered.
  }
}

/** A message worth reading, whatever was thrown. */
export function describe(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`;
  }
  return String(error);
}

function formatTags(tags: NonNullable<ErrorContext["tags"]>): string {
  return Object.entries(tags)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
}
