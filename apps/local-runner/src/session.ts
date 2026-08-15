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
  private finished = false;

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
    if (this.finished) {
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

  get isFinished(): boolean {
    return this.finished;
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
    if (this.finished) {
      return;
    }
    for (const [, resolve] of this.pending) {
      resolve("the session was destroyed before this tool call was answered");
    }
    this.pending.clear();
    this.abort.abort();

    // The workspace comes first, and `finished` is only set once it is gone.
    // Marking the session finished before the removal succeeded hid it from
    // the runtime listing *and* made the retry a no-op, so a directory that
    // failed to delete could never be cleaned up by anything.
    await this.workspace.destroy();

    this.finished = true;
    this.emit({ kind: "terminated" });
    this.listeners.clear();
  }

  get dir(): string {
    return this.workspace.dir;
  }
}
