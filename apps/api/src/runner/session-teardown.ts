import { Injectable, Logger } from "@nestjs/common";
import { SessionsService } from "../sessions/sessions.service";
import type { Runner, RunnerHandle } from "./runner.types";

/**
 * Ending a session: recording what happened, and freeing the container.
 *
 * Separate from the orchestrator because the ordering rules here are the whole
 * point — the container is released on every path, including the ones where
 * writing the record is what failed.
 */
@Injectable()
export class SessionTeardown {
  private readonly logger = new Logger(SessionTeardown.name);

  constructor(private readonly sessions: SessionsService) {}

  /**
   * Records the failure and frees the container, in that order but never
   * conditionally on it.
   *
   * The recording is the part most likely to be *what* failed — a database
   * outage takes down `sessions.finish` and every session in flight at once.
   * Destroying inside a `finally` means the container still goes away exactly
   * when the control plane is least able to notice it did not.
   */
  async failAndRelease(
    runner: Runner,
    handle: RunnerHandle | null,
    sessionId: string,
    error: unknown,
  ): Promise<void> {
    this.logger.error(`session ${sessionId} failed: ${String(error)}`);
    try {
      await this.sessions.finish(sessionId, { status: "failed", error: String(error) });
    } catch (recordError) {
      this.logger.error(`session ${sessionId}: could not record the failure: ${String(recordError)}`);
    } finally {
      await this.destroyQuietly(runner, handle, sessionId);
    }
  }

  /**
   * The destroy that runs when something has already gone wrong.
   *
   * A failed run still holds a container, and a container nobody is watching
   * bills until someone notices. The failure that brought us here is the one
   * worth reporting, so a destroy that also fails is logged and swallowed
   * rather than replacing it.
   */
  async destroyQuietly(
    runner: Runner,
    handle: RunnerHandle | null,
    sessionId: string,
  ): Promise<void> {
    if (!handle) {
      return;
    }
    try {
      await runner.destroy(handle);
      // Only now: the row keeps its vault ids until the credentials are
      // provably gone, which is what makes the retry queue self-maintaining.
      await this.sessions.clearVaults(sessionId);
    } catch (error) {
      this.logger.error(
        `session ${sessionId}: the container could not be destroyed ` +
          `(${handle.runtimeSessionId}): ${String(error)}`,
      );
      // The row must not claim a clean end the runtime never gave us.
      await this.sessions
        .recordDestroyFailure(sessionId, String(error))
        .catch((recordError: unknown) =>
          this.logger.error(`session ${sessionId}: ${String(recordError)}`),
        );
    }
  }

  /**
   * Reads spend, closes the session record, then frees the container.
   *
   * The destroy is in a `finally` for the same reason as the failure path: if
   * writing the record throws, the container must still go away. A row that
   * says "running" next to a container that does not exist is a nuisance; a
   * container that exists with no row is a bill.
   */
  async finish(
    runner: Runner,
    handle: RunnerHandle,
    sessionId: string,
    failure: string | null,
  ): Promise<number | null> {
    const costUsd = await runner.readCost(handle);
    try {
      await this.sessions.finish(sessionId, {
        status: failure ? "failed" : "destroyed",
        error: failure,
        costUsd,
      });
    } finally {
      await this.destroyQuietly(runner, handle, sessionId);
    }
    return costUsd;
  }
}
