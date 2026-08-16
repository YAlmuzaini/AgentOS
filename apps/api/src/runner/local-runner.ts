import { Inject, Injectable, Logger } from "@nestjs/common";
import { APP_CONFIG, type AppConfig } from "../config/config";
import type {
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
    await this.call(`/sessions/${handle.runtimeSessionId}`, { method: "DELETE" });
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

  private async call(route: string, init: RequestInit = {}): Promise<Response> {
    if (!this.configured) {
      throw new Error("LOCAL_RUNNER_URL is not set");
    }
    const response = await fetch(`${this.base()}${route}`, {
      ...init,
      headers: { ...this.headers(), ...(init.headers ?? {}) },
    });
    if (!response.ok) {
      throw new Error(`local runner ${route}: ${response.status} ${await response.text()}`);
    }
    return response;
  }
}
