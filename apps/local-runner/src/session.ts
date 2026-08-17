import { randomUUID } from "node:crypto";
import { rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { stampQuarantine } from "./workspace.js";
import type { ProvisionBody, RunnerEvent } from "./protocol.js";
import {
  holdsUnpushedWork,
  type PublishRecord,
  publishCommits,
  type Workspace,
} from "./workspace.js";

type Listener = (event: RunnerEvent) => void;

/**
 * One local run: its event history, its open tool calls, and its lifetime.
 *
 * The event *history* is the part that matters. The control plane disconnects
 * from the stream whenever a session parks on an inbox question, and reconnects
 * when the operator answers, so a session must be able to replay everything it
 * has emitted. Replayed events carry their original ids and the control plane
 * dedupes on them — the same contract the cloud runner has.
 */
export class LocalSession {
  readonly id = `lsesn_${randomUUID()}`;
  readonly startedAt = new Date();

  private readonly history: RunnerEvent[] = [];
  private readonly listeners = new Set<Listener>();
  private readonly pending = new Map<string, (result: string) => void>();

  private costUsd: number | null = null;
  /** The run is over: no more events, and the stream has been closed. */
  private runEnded = false;
  /** The throwaway directory is gone. Until then this session is not done. */
  private workspaceRemoved = false;
  /**
   * Set when a push failed and the workspace holds the only copy of the work.
   *
   * A quarantined session is never deleted by `destroy`, because deleting it
   * would throw away commits that exist nowhere else — which is the exact
   * failure this whole path was built to stop. The directory is renamed out of
   * the `session-` namespace so the boot sweep leaves it alone too.
   */
  private quarantinedAt: string | null = null;
  /** The result of the last publish attempt, so a repeat call is a no-op. */
  private published: PublishRecord[] | null = null;

  constructor(
    readonly input: ProvisionBody,
    private readonly workspace: Workspace,
    private readonly abort: AbortController,
  ) {}

  /**
   * Every secret this session was handed, longest first.
   *
   * Built once, because it is applied to every event. Longest-first matters:
   * if one credential is a prefix of another, replacing the short one first
   * leaves the tail of the long one behind.
   */
  private secretsCache: string[] | null = null;

  private get secrets(): string[] {
    // Lazily, because a field initializer runs before the constructor's
    // parameter properties exist — `this.input` is not there yet.
    this.secretsCache ??= [
      ...this.input.mcpServers.map((server) => server.token),
      ...this.input.repos.map((repo) => repo.token),
      ...this.input.envVars.map((variable) => variable.value),
    ]
      // Back to eight, deliberately, after four proved worse than the leak it
      // was closing. Redaction is substring replacement applied *before* the
      // control plane sees the event, so a granted four-character value like
      // `task` rewrites the legitimate tool name `agentos_update_task` into
      // something the control plane rejects as unknown — a short secret does
      // not just mangle a log line, it breaks the session's actions.
      //
      // Eight characters covers every credential format in the shipped
      // catalogue and every token any of these vendors issues. A shorter
      // secret — a numeric PIN, say — is not substring-redacted; the `Bearer …`
      // pattern below still catches it in the shape it usually appears in.
      .filter((value): value is string => Boolean(value) && String(value).length >= 8)
      .sort((a, b) => b.length - a.length);
    return this.secretsCache;
  }

  /**
   * Removes this session's own credentials from anything it says.
   *
   * The worker forwards SDK errors verbatim, and an MCP server that echoes
   * `Authorization: Bearer …` in an error message puts a live token into that
   * string — which the control plane then writes into the tool-call log and
   * the session's failure text. The verifier scrubbed its own path; ordinary
   * sessions did not, and they are the ones that run unattended.
   *
   * Done here rather than at each call site so a future `emit` cannot forget.
   */
  /** The session's own scrubber, for callers that build text outside `emit`. */
  scrub(text: string): string {
    return this.redact(text);
  }

  private redact(text: string): string {
    let safe = text;
    for (const secret of this.secrets) {
      safe = safe.split(secret).join("<redacted>");
    }
    return safe.replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer <redacted>");
  }

  /** Walks a tool call's arguments, scrubbing every string it finds. */
  private redactDeep(value: unknown): unknown {
    if (typeof value === "string") {
      return this.redact(value);
    }
    if (Array.isArray(value)) {
      return value.map((entry) => this.redactDeep(entry));
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
          key,
          this.redactDeep(entry),
        ]),
      );
    }
    return value;
  }

  emit(event: RunnerEvent): void {
    // Every field that carries free text, not just the obvious one. A tool
    // *name* is chosen by the MCP server, a tool call's arguments are chosen
    // by the agent, and both cross the event stream into the tool-call log.
    if (event.kind === "error") {
      event = { ...event, message: this.redact(event.message) };
    } else if (event.kind === "log") {
      event = {
        ...event,
        summary: this.redact(event.summary),
        // A log's `name` is descriptive rather than dispatched, so scrubbing
        // it here changes nothing but the text.
        name: event.name === null ? null : this.redact(event.name),
      };
    } else if (event.kind === "tool-call") {
      event = {
        ...event,
        call: {
          ...event.call,
          // The *name* is deliberately untouched: it is a dispatch key, and
          // rewriting it here happens before the control plane ever sees it —
          // a granted secret that happens to equal `inbox_send` would turn a
          // real tool call into an unknown one. The control plane scrubs names
          // at the point it *stores* them, which is after dispatch and
          // therefore safe.
          input: this.redactDeep(event.call.input) as Record<string, unknown>,
        },
      };
    }
    this.history.push(event);
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  /** Replays history, then streams. Returns an unsubscribe. */
  subscribe(listener: Listener): () => void {
    for (const event of this.history) {
      listener(event);
    }
    if (this.runEnded) {
      listener({ kind: "terminated" });
      return () => {};
    }
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Emits a tool call and waits for the control plane to answer it.
   *
   * This is the whole point of the local runner's design: the VM decides
   * nothing. `agentos_update_task`, `inbox_ask`, and every filesystem call are
   * executed by the control plane, which is the only party holding the
   * database and the operator's authority. The worker just carries the message.
   */
  callTool(name: string, input: Record<string, unknown>): Promise<string> {
    const toolUseId = `ltool_${randomUUID()}`;
    return new Promise<string>((resolve) => {
      this.pending.set(toolUseId, resolve);
      this.emit({ kind: "tool-call", eventId: toolUseId, call: { toolUseId, name, input } });
      // Tells the control plane the run is blocked on us, which is how a
      // parked session is distinguished from a finished one.
      this.emit({ kind: "idle", stopReason: "requires_action" });
    });
  }

  /** Returns false when the id is unknown — a replay, or a stale answer. */
  answerTool(toolUseId: string, result: string): boolean {
    const resolve = this.pending.get(toolUseId);
    if (!resolve) {
      return false;
    }
    this.pending.delete(toolUseId);
    resolve(result);
    return true;
  }

  /**
   * Pushes this session's commits, once.
   *
   * Idempotent by memoisation: teardown can be retried — a duplicate DELETE, a
   * control-plane restart mid-teardown — and a second push attempt against a
   * remote that already has the commits would report a spurious failure. The
   * first answer is the answer.
   */
  async publish(): Promise<PublishRecord[]> {
    // The *promise*, not the result. Memoising only the finished value left a
    // window where two callers — the worker's own timeout and the control
    // plane's teardown, which the timeout invites by ending the run — both saw
    // "not published yet" and pushed concurrently.
    this.publishing ??= this.runPublish();
    return this.publishing;
  }

  private publishing: Promise<PublishRecord[]> | null = null;

  private async runPublish(): Promise<PublishRecord[]> {
    if (this.published) {
      return this.published;
    }
    if (this.workspaceRemoved) {
      // Nothing left to push from. Say so rather than reporting success.
      this.published = this.input.repos
        .filter((repo) => repo.permissions === "git-write")
        .map((repo) => ({
          repo: repo.name,
          branch: repo.branch,
          pushed: false,
          remoteSha: null,
          commits: 0,
          error: "the workspace was already removed, so nothing could be pushed",
        }));
      return this.published;
    }

    const records = await publishCommits(
      this.workspace.dir,
      this.input.repos,
      this.workspace.baseShas,
    );
    this.published = records;

    // Any failure at all, not just one with a commit count attached. The count
    // is read *from git*, so a failure that happens before it — an agent that
    // deleted `refs/remotes/origin/main`, a corrupt index — leaves it at zero
    // while the work is still sitting there. Treating zero as "nothing to
    // keep" made the least recoverable case the one that got deleted.
    if (records.some((record) => !record.pushed)) {
      await this.quarantine();
    }
    return records;
  }

  /** Clone-time shas, for callers that need a trust source outside the checkout. */
  get baseShas(): Map<string, string> {
    return this.workspace.baseShas;
  }

  /** Where the retained workspace is, or null when nothing was retained. */
  get retainedWorkspace(): string | null {
    return this.quarantinedAt;
  }

  private quarantining: Promise<void> | null = null;

  private quarantine(): Promise<void> {
    // Single-flight, like publish. Two concurrent `destroy()` calls both passed
    // the null check, one rename won, and the loser overwrote `quarantinedAt`
    // with a path that no longer existed — sending the operator to recover work
    // from an empty directory.
    this.quarantining ??= this.runQuarantine();
    return this.quarantining;
  }

  private async runQuarantine(): Promise<void> {
    if (this.quarantinedAt) {
      return;
    }
    const kept = join(dirname(this.workspace.dir), `quarantine-${this.id}`);
    try {
      await rename(this.workspace.dir, kept);
      this.quarantinedAt = kept;
      // The retention clock, written down rather than inferred. A rename does
      // not update the moved directory's own mtime, so the boot sweep was
      // reading the age of the *session*, not of the quarantine — a workspace
      // set aside from a fortnight-old session was eligible for deletion on the
      // very next boot, which is no recovery window at all.
      await stampQuarantine(kept);
    } catch (error) {
      // Renaming is only a convenience — it takes the directory out of the
      // `session-` prefix the boot sweep deletes. If it fails, keeping the
      // original path is still better than destroying it.
      this.quarantinedAt = this.workspace.dir;
      console.error(`session ${this.id}: could not move the workspace aside: ${String(error)}`);
    }
  }

  recordCost(costUsd: number | null): void {
    if (costUsd !== null) {
      this.costUsd = costUsd;
    }
  }

  get cost(): number | null {
    return this.costUsd;
  }

  /**
   * Whether this session can be forgotten.
   *
   * Both halves have to be true. A run that ended but whose workspace is still
   * on disk stays visible to the runtime listing on purpose — that listing is
   * what the control plane's orphan sweep reads, and it is the only thing that
   * will ever come back and try the removal again.
   */
  get isFinished(): boolean {
    return this.runEnded && this.workspaceRemoved;
  }

  /** True once the run is over, whatever happened to its directory. */
  get hasEnded(): boolean {
    return this.runEnded;
  }

  /**
   * Ends the run and removes the workspace.
   *
   * Any tool call still waiting is answered with a refusal rather than left
   * hanging: an unresolved promise here would keep the Claude Code process
   * alive forever, which is exactly the leak this whole subsystem exists to
   * avoid.
   */
  /**
   * Stops the run, and nothing else.
   *
   * Separated from `destroy` so a caller can end the agent *before* publishing.
   * Publishing first was a snapshot of a moving target: the agent was still
   * alive and could commit after the push and before the deletion, so that
   * commit reached no remote and was then thrown away with the directory.
   */
  endRunOnly(): void {
    this.endRun();
  }

  async destroy(): Promise<void> {
    // Ending the run and removing the workspace are separate outcomes, and
    // conflating them wedged both. Removing first meant a directory that would
    // not delete never emitted `terminated`, so the control plane's event
    // stream stayed open forever and the queue job holding it never finished —
    // a handful of those exhausts the worker. Setting `finished` first was the
    // opposite mistake: it hid the session from the runtime listing, so the
    // orphan sweep could never come back for the workspace either.
    this.endRun();

    if (this.workspaceRemoved) {
      return;
    }
    // The last gate: never delete a directory that still holds commits no
    // remote has.
    //
    // Publishing takes a snapshot, and the agent is not reliably stopped when
    // it is taken — `endRunOnly` signals cancellation, but a shell subprocess
    // started by the Grok engine never receives it, and nothing here can wait
    // for a process it did not spawn. So the check moved to the moment the loss
    // would actually happen.
    //
    // **This narrows the race; it does not close it.** A commit completing
    // between this check and `workspace.destroy()` below is still lost. Closing
    // it properly needs the worker to own the agent's process group and reap it
    // before teardown, which is a change to how sessions are spawned rather
    // than to how they are cleaned up. The window here is milliseconds and the
    // failure is loud in the logs; the previous window was the whole teardown.
    if (!this.quarantinedAt && (await holdsUnpushedWork(this.workspace.dir, this.workspace.baseShas))) {
      console.error(
        `session ${this.id}: commits appeared after the push was attempted; keeping the workspace`,
      );
      await this.quarantine();
    }

    if (this.quarantinedAt) {
      // The commits in here exist nowhere else. Treat the session as done so
      // the worker stops tracking it, but leave the directory for the operator
      // — losing the work is the worse failure by a wide margin.
      this.workspaceRemoved = true;
      console.error(
        `session ${this.id}: workspace retained at ${this.quarantinedAt} because its commits ` +
          "could not be pushed; recover them by hand, then delete the directory",
      );
      return;
    }
    // Throws on failure, so the caller records it — but the run is already
    // over and the session stays in the listing until this succeeds, which is
    // what makes a later DELETE or an orphan sweep a real retry.
    await this.workspace.destroy();
    this.workspaceRemoved = true;
  }

  /** Ends the run itself. Idempotent, and never blocked by cleanup. */
  private endRun(): void {
    if (this.runEnded) {
      return;
    }
    this.runEnded = true;
    for (const [, resolve] of this.pending) {
      resolve("the session was destroyed before this tool call was answered");
    }
    this.pending.clear();
    this.abort.abort();
    this.emit({ kind: "terminated" });
    this.listeners.clear();
  }

  get dir(): string {
    return this.workspace.dir;
  }
}
