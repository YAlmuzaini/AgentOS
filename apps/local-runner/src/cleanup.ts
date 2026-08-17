/** The minimum of a session this teardown needs. Keeps it testable without a
 * workspace, a child process, or a git remote. */
export interface CleanupTarget {
  readonly id: string;
  readonly dir: string;
  endRunOnly(): void;
  publish(): Promise<unknown>;
  destroy(): Promise<void>;
}

export interface CleanupHooks {
  /** Give back the execution permit. Called exactly once, before the retries. */
  releaseCapacity(id: string): void;
  /** Drop the session from the worker's map. Only on a successful delete. */
  forget(id: string): void;
  log(message: string): void;
}

export const CLEANUP_ATTEMPTS = 4;
export const CLEANUP_BACKOFF_MS = 2_000;

/**
 * Ends a session and keeps trying to remove its workspace.
 *
 * The order is the whole point:
 *
 *   1. Stop the agent. It is still running — this is the worker's own hard
 *      ceiling firing — and publishing while it works snapshots a moving
 *      target: a commit made after the push and before the deletion would
 *      reach no remote and then be deleted with the directory.
 *   2. Publish, because nothing else will ever ask for these commits; the
 *      control plane is not driving this path.
 *   3. **Release the execution permit.** Execution and publishing are over, so
 *      the permit no longer represents work. Releasing it here rather than
 *      after a successful delete is the fix for a real capacity leak: a
 *      workspace that survived every attempt kept its slot for ever, and two
 *      of them made a two-slot worker permanently unready. A recoverable disk
 *      problem must not become an unrecoverable capacity one.
 *   4. Retry the delete. A session whose workspace survives every attempt
 *      stays in the map on purpose — it remains visible to `GET /sessions`,
 *      which is what the control plane's orphan sweep reads, and a retained
 *      (quarantined) workspace keeps its path, so the operator gets a retry
 *      rather than a directory nobody remembers.
 */
export async function endAndClean(
  session: CleanupTarget,
  hooks: CleanupHooks,
  options: {
    attempts?: number;
    backoffMs?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<{ destroyed: boolean }> {
  const attempts = options.attempts ?? CLEANUP_ATTEMPTS;
  const backoffMs = options.backoffMs ?? CLEANUP_BACKOFF_MS;
  const sleep =
    options.sleep ??
    ((ms: number) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, ms);
        timer.unref?.();
      }));

  session.endRunOnly();

  try {
    await session.publish();
  } catch (error) {
    hooks.log(`session ${session.id}: could not publish before cleanup: ${String(error)}`);
  }

  hooks.releaseCapacity(session.id);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await session.destroy();
      hooks.forget(session.id);
      return { destroyed: true };
    } catch (error) {
      hooks.log(
        `session ${session.id}: cleanup attempt ${attempt}/${attempts} failed: ${String(error)}`,
      );
      if (attempt < attempts) {
        await sleep(attempt * backoffMs);
      }
    }
  }
  hooks.log(
    `session ${session.id}: workspace ${session.dir} could not be removed; ` +
      "it stays listed so the control plane can retry the delete",
  );
  return { destroyed: false };
}
