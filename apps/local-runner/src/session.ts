import { randomUUID } from "node:crypto";
import type { ProvisionBody, RunnerEvent } from "./protocol.js";
import type { Workspace } from "./workspace.js";

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

  constructor(
    readonly input: ProvisionBody,
    private readonly workspace: Workspace,
    private readonly abort: AbortController,
  ) {}

  emit(event: RunnerEvent): void {
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
