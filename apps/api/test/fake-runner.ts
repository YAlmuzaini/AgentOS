import type {
  CommitRecord,
  PublishOutcome,
  ProvisionInput,
  Runner,
  RunnerEvent,
  RunnerHandle,
} from "../src/runner/runner.types";

/**
 * A scripted backend that satisfies the Runner contract without a container.
 *
 * This is what lets the SPEC §22 acceptance tests run at all: they assert on
 * control-plane behaviour (approval gates, grants, parking, destroy), none of
 * which needs a live model. Each test scripts the tool calls the "agent" makes
 * and then reads back what AgentOS did about them.
 */
export interface ScriptedToolCall {
  name: string;
  input: Record<string, unknown>;
}

export type Script = Array<
  | { kind: "tool"; call: ScriptedToolCall }
  | { kind: "log"; type: string; summary?: string; name?: string }
>;

export class FakeRunner implements Runner {
  /**
   * Which backend this is standing in for.
   *
   * Mutable because one behaviour genuinely differs between them: only a
   * backend that still holds the checkout can report commits, and only the
   * local one cannot push them anywhere.
   */
  name: "cloud" | "local" = "cloud";

  /** Everything the control plane asked this backend to do, for assertions. */
  readonly provisioned: ProvisionInput[] = [];
  readonly injectedResults: Array<{ toolUseId: string; result: string }> = [];
  readonly destroyed: string[] = [];
  /** Vault ids each destroy was asked to clean up, for leak assertions. */
  readonly destroyedVaults: string[][] = [];
  private failDestroyWith: Error | null = null;

  private script: Script = [];
  private nextEventId = 0;
  private failProvisionWith: Error | null = null;
  private failStreamWith: Error | null = null;
  private hangStream = false;

  /**
   * Queue the calls the agent will make on its next run.
   *
   * The event counter deliberately keeps running across scripts: a resumed
   * session must produce *new* event ids, or the orchestrator's reconnect
   * dedupe would correctly discard them and the test would be testing the
   * fake rather than the product.
   */
  setScript(script: Script): void {
    this.script = script;
  }

  failNextProvision(error: Error): void {
    this.failProvisionWith = error;
  }

  /** Fails mid-run, once the container exists — the path that can leak one. */
  failNextStream(error: Error): void {
    this.failStreamWith = error;
  }

  /**
   * Provisions and then never emits anything again, for ever.
   *
   * Deliberately *not* bounded by a timer. An earlier version resolved after
   * ten seconds, and that hid the bug it was supposed to catch: the deadline
   * appeared to work while it was really the timer ending the stream. A real
   * silent session never resolves, and the only thing that can end it is the
   * abort signal — which is what this now models, the way both real backends
   * do by handing the signal to their own request.
   */
  hangNextStream(): void {
    this.hangStream = true;
  }

  async provision(input: ProvisionInput): Promise<RunnerHandle> {
    if (this.failProvisionWith) {
      const error = this.failProvisionWith;
      this.failProvisionWith = null;
      throw error;
    }
    this.provisioned.push(input);
    return {
      runtimeSessionId: `sesn_fake_${this.provisioned.length}`,
      traceUrl: null,
      // Mirrors the cloud runner: a session with credentials mints a vault, and
      // destroy is expected to carry the ids back so it can delete them.
      vaultIds: input.envVars.length > 0 || input.mcpServers.length > 0 ? ["vlt_fake"] : [],
    };
  }

  async *streamEvents(
    _handle: RunnerHandle,
    seen: Set<string>,
    signal?: AbortSignal,
  ): AsyncIterable<RunnerEvent> {
    if (this.failStreamWith) {
      const error = this.failStreamWith;
      this.failStreamWith = null;
      throw error;
    }
    if (this.hangStream) {
      this.hangStream = false;
      // Never resolves on its own. Rejecting on abort is what a real backend
      // does when the request carrying its stream is cancelled — and it is the
      // only thing that can end a session which has gone silent.
      await new Promise((_resolve, reject) => {
        // Both real backends reject immediately on an already-aborted signal;
        // only checking the event would hang where they would not.
        if (signal?.aborted) {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          return;
        }
        signal?.addEventListener(
          "abort",
          () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          { once: true },
        );
      });
      return;
    }
    const script = this.script;
    this.script = [];

    for (const step of script) {
      this.nextEventId += 1;
      const eventId = `sevt_${this.nextEventId}`;
      if (seen.has(eventId)) {
        continue;
      }
      seen.add(eventId);

      if (step.kind === "tool") {
        yield {
          kind: "tool-call",
          eventId,
          call: { toolUseId: eventId, name: step.call.name, input: step.call.input },
        };
        continue;
      }
      yield {
        kind: "log",
        eventId,
        type: step.type,
        name: step.name ?? null,
        summary: step.summary ?? "",
      };
    }

    yield { kind: "idle", stopReason: "end_turn" };
  }

  async injectToolResult(_handle: RunnerHandle, toolUseId: string, result: string): Promise<void> {
    this.injectedResults.push({ toolUseId, result });
  }

  async readCost(): Promise<number | null> {
    return 0.25;
  }

  /** Commits the next teardown will observe, as a given backend. */
  collectCommitsWith(name: "cloud" | "local", commits: CommitRecord[]): void {
    this.name = name;
    this.commits = commits;
  }

  private commits: CommitRecord[] | null = null;

  async collectCommits(): Promise<CommitRecord[]> {
    return this.commits ?? [];
  }

  /** What the next teardown's publish step will report. Unset means no push. */
  publishWith(outcome: PublishOutcome | null): void {
    this.publishOutcome = outcome;
  }

  private publishOutcome: PublishOutcome | null = null;

  /** Makes the next publish call fail the way an unreachable worker does. */
  failNextPublish(error: Error): void {
    this.failPublishWith = error;
  }

  private failPublishWith: Error | null = null;

  async publish(): Promise<PublishOutcome> {
    if (this.failPublishWith) {
      const error = this.failPublishWith;
      this.failPublishWith = null;
      throw error;
    }
    return this.publishOutcome ?? { records: [], retainedWorkspace: null };
  }

  /** Makes the next destroy fail, the way a provider outage would. */
  failNextDestroy(error: Error): void {
    this.failDestroyWith = error;
  }

  async destroy(handle: RunnerHandle): Promise<void> {
    this.destroyed.push(handle.runtimeSessionId);
    this.destroyedVaults.push(handle.vaultIds ?? []);
    if (this.failDestroyWith) {
      const error = this.failDestroyWith;
      this.failDestroyWith = null;
      throw error;
    }
  }

  /** Vault ids the control plane asked to be cleaned up out of band. */
  readonly vaultsDeleted: string[] = [];

  async deleteVaults(vaultIds: string[]): Promise<void> {
    this.vaultsDeleted.push(...vaultIds);
  }

  /** What the runtime claims is running, for the orphan sweep. */
  runtimeSessions: RuntimeSessionSummary[] = [];

  async listRuntimeSessions(): Promise<RuntimeSessionSummary[]> {
    return this.runtimeSessions;
  }

  reset(): void {
    this.name = "cloud";
    this.commits = null;
    this.provisioned.length = 0;
    this.injectedResults.length = 0;
    this.destroyed.length = 0;
    this.script = [];
    this.nextEventId = 0;
    this.failProvisionWith = null;
    this.failStreamWith = null;
    this.failDestroyWith = null;
    this.hangStream = false;
    this.destroyedVaults.length = 0;
    this.runtimeSessions = [];
    this.vaultsDeleted.length = 0;
  }
}
