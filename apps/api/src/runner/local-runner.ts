import { Inject, Injectable, Logger } from "@nestjs/common";
import { APP_CONFIG, type AppConfig } from "../config/config";
import type {
  PublishOutcome,
  CommitRecord,
  ProvisionInput,
  Runner,
  RunnerEvent,
  RunnerHandle,
  RuntimeSessionSummary,
} from "./runner.types";

/**
 * The cheap backend (SPEC §16): a worker on a VM the operator owns, running a
 * local coding CLI instead of Anthropic's managed sandbox.
 *
 * This is the *client* half. The VM-side worker is a separate deployable that
 * long-polls this protocol; it is not part of the control plane and is not in
 * this repository. The contract it must implement:
 *
 *   POST /sessions            {systemPrompt, kickoff, tools, environment, repos,
 *                              mcpServers, envVars} -> {id}
 *   GET  /sessions/:id/events  Server-sent events, one JSON RunnerEvent per frame
 *   POST /sessions/:id/tool-result {toolUseId, result} -> 204
 *   GET  /sessions/:id/cost    -> {costUsd}
 *   DELETE /sessions/:id       -> 204   (must destroy the workspace)
 *
 * Everything above the Runner interface is identical to the cloud path, which
 * is the point of having the interface at all.
 */
@Injectable()
export class LocalVmRunner implements Runner {
  readonly name = "local" as const;

  private readonly logger = new Logger(LocalVmRunner.name);

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /** The worker's origin, for the settings screen. Never a credential. */
  endpointForDisplay(): string | null {
    return this.configured ? this.base() : null;
  }

  /** Routing asks this before sending work here. */
  get configured(): boolean {
    return Boolean(this.config.LOCAL_RUNNER_URL);
  }

  async healthy(): Promise<boolean> {
    if (!this.configured) {
      return false;
    }
    try {
      const response = await fetch(`${this.base()}/health`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(2000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async provision(input: ProvisionInput): Promise<RunnerHandle> {
    const response = await this.call("/sessions", {
      method: "POST",
      body: JSON.stringify({
        agent: input.agent.name,
        model: input.agent.model,
        systemPrompt: input.systemPrompt,
        kickoff: input.kickoff,
        tools: input.tools,
        environment: input.environment,
        repos: input.repos,
        mcpServers: input.mcpServers,
        envVars: input.envVars,
        budgetUsd: input.budgetUsd,
      }),
    });
    const body = (await response.json()) as { id: string };
    return { runtimeSessionId: body.id, traceUrl: null };
  }

  async *streamEvents(
    handle: RunnerHandle,
    seen: Set<string>,
    signal?: AbortSignal,
  ): AsyncIterable<RunnerEvent> {
    const response = await this.call(`/sessions/${handle.runtimeSessionId}/events`, {
      headers: { accept: "text/event-stream" },
      // Aborting the fetch is what actually ends a read that is waiting on a
      // worker with nothing to say.
      signal,
    });
    if (!response.body) {
      yield { kind: "error", message: "local runner returned no event stream" };
      return;
    }

    const reader = response.body.getReader();
    try {
      yield* this.readFrames(reader, seen);
    } finally {
      // The reader holds the socket. Leaving it locked kept a connection open
      // for the life of the process every time a run ended early.
      await reader.cancel().catch(() => {
        // The stream is already gone; nothing left to release.
      });
    }
  }

  private async *readFrames(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    seen: Set<string>,
  ): AsyncIterable<RunnerEvent> {
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line.
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");

        const payload = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("");
        if (!payload) {
          continue;
        }

        let event: RunnerEvent;
        try {
          event = JSON.parse(payload) as RunnerEvent;
        } catch {
          this.logger.warn("local runner sent a frame that was not JSON");
          continue;
        }

        // Same reconnect contract as the cloud runner.
        const eventId = "eventId" in event ? event.eventId : null;
        if (eventId) {
          if (seen.has(eventId)) {
            continue;
          }
          seen.add(eventId);
        }

        yield event;
        if (event.kind === "terminated") {
          return;
        }
        if (event.kind === "idle" && event.stopReason !== "requires_action") {
          return;
        }
      }
    }
  }

  async injectToolResult(handle: RunnerHandle, toolUseId: string, result: string): Promise<void> {
    await this.call(`/sessions/${handle.runtimeSessionId}/tool-result`, {
      method: "POST",
      body: JSON.stringify({ toolUseId, result }),
    });
  }

  async readCost(handle: RunnerHandle): Promise<number | null> {
    try {
      const response = await this.call(`/sessions/${handle.runtimeSessionId}/cost`);
      const body = (await response.json()) as { costUsd?: number };
      return body.costUsd ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Ends the run on the worker.
   *
   * Throws on failure rather than logging and returning: swallowing it told the
   * control plane the workspace was gone when the worker may still be running
   * the session, and nothing downstream could record or retry it.
   */
  async destroy(handle: RunnerHandle): Promise<void> {
    // A 404 means the worker has no such session, which is the *goal* state,
    // not a failure. Treating it as one made teardown non-idempotent in the
    // ordinary case: the first DELETE succeeds, its 204 is lost to a dropped
    // connection, the retry gets 404, and the session row is stamped
    // "container was not destroyed" for a container that certainly was —
    // sending someone to look for a workspace that no longer exists.
    await this.call(`/sessions/${handle.runtimeSessionId}`, {
      method: "DELETE",
      allowNotFound: true,
    });
  }

  /**
   * What this session actually committed, read out of the workspace before it
   * is deleted (SPEC §6).
   *
   * The one backend that can answer this honestly: the checkout is a directory
   * on a machine we control, so the commits are observed rather than attested.
   */
  async collectCommits(handle: RunnerHandle): Promise<CommitRecord[]> {
    const response = await this.call(`/sessions/${handle.runtimeSessionId}/commits`);
    const body = (await response.json()) as CommitRecord[];
    return Array.isArray(body) ? body : [];
  }

  /**
   * Pushes this session's commits to the granted remotes.
   *
   * The worker holds the installation token; the agent never did. Failure is
   * reported rather than thrown so teardown continues — the important part of a
   * failed push is that the worker kept the workspace, and the operator needs
   * the session row to say so.
   */
  async publish(handle: RunnerHandle): Promise<PublishOutcome> {
    const response = await this.call(`/sessions/${handle.runtimeSessionId}/publish`, {
      method: "POST",
      // The worker has already forgotten this session: there is no workspace
      // left to push from, and saying so is not the same as failing to ask.
      allowNotFound: true,
    });
    if (response.status === 404) {
      // A 404 is two different answers wearing one status. It means "no such
      // session" from a worker that has this route, and "no such route" from
      // one that predates it — and the second is a *live* session whose
      // commits are still there. Destroying on that reading deletes them, so
      // the worker is asked what it can do before the 404 is believed.
      if (!(await this.supportsPublish())) {
        throw new Error(
          "this worker does not implement /publish, so whether this session's commits were " +
            "pushed cannot be established. Upgrade the worker, or recover the workspace by hand.",
        );
      }
      // The worker has this route and still says no such session: it
      // restarted. Its boot sweep keeps any workspace that held a checkout,
      // and that directory is the only place the work now exists.
      return { records: [], retainedWorkspace: null, forgotten: true };
    }
    const body = (await response.json()) as PublishOutcome;
    return {
      records: Array.isArray(body?.records) ? body.records : [],
      retainedWorkspace: body?.retainedWorkspace ?? null,
    };
  }

  /** Whether this worker implements `/publish`, per its own health report. */
  private async supportsPublish(): Promise<boolean> {
    try {
      const response = await this.call("/health");
      const body = (await response.json()) as { capabilities?: unknown };
      return Array.isArray(body.capabilities) && body.capabilities.includes("publish");
    } catch {
      // Could not ask, so nothing is established.
      return false;
    }
  }

  /**
   * Sessions this worker still holds. Without it a local container that
   * outlives its session row is invisible to the sweep, which is the same gap
   * the cloud runner already closed.
   */
  async listRuntimeSessions(): Promise<RuntimeSessionSummary[]> {
    const response = await this.call("/sessions");
    const body = (await response.json()) as Array<{ id: string; startedAt: string }>;
    return body.map((session) => {
      const startedAt = new Date(session.startedAt);
      return {
        runtimeSessionId: session.id,
        // An unparseable timestamp reads as "just started", which keeps the
        // session inside the sweep's grace period rather than archiving it.
        startedAt: Number.isNaN(startedAt.getTime()) ? new Date() : startedAt,
      };
    });
  }

  private base(): string {
    return this.config.LOCAL_RUNNER_URL.replace(/\/$/, "");
  }

  private headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      ...(this.config.LOCAL_RUNNER_TOKEN
        ? { authorization: `Bearer ${this.config.LOCAL_RUNNER_TOKEN}` }
        : {}),
    };
  }

  private async call(
    route: string,
    init: RequestInit & { allowNotFound?: boolean } = {},
  ): Promise<Response> {
    if (!this.configured) {
      throw new Error("LOCAL_RUNNER_URL is not set");
    }
    const { allowNotFound, ...request } = init;
    const response = await fetch(`${this.base()}${route}`, {
      ...request,
      headers: { ...this.headers(), ...(init.headers ?? {}) },
    });
    if (!response.ok && !(allowNotFound && response.status === 404)) {
      throw new Error(`local runner ${route}: ${response.status} ${await response.text()}`);
    }
    return response;
  }
}
