import type { ToolCallLogEntry } from "@agentos/shared";
import { Injectable } from "@nestjs/common";
import { SessionsService } from "../sessions/sessions.service";
import { redactRegistered } from "../observability/secret-registry";
import { isAbortError, RunCancellation } from "./run-cancellation";
import type { Runner, RunnerHandle } from "./runner.types";
import { AgentToolHandler, type ToolContext } from "./tool-handler";

/** What the session log says when a run was cut off rather than finished. */
const CANCEL_REASONS = {
  deadline: "the goal's time limit ran out while this session was still running",
  revoked: "this goal handed its turn to another dispatch; the session was stopped",
} as const;

/** Walks a tool call's arguments, scrubbing every string it finds. */
function redactDeep(value: unknown): unknown {
  if (typeof value === "string") {
    return redactRegistered(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactDeep(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        redactDeep(entry),
      ]),
    );
  }
  return value;
}

export interface ConsumeResult {
  /** True when the run stopped on an inbox question and must not be destroyed. */
  parked: boolean;
  /** What the agent did, for the goal progress log and the activity feed. */
  summary: string;
  failure: string | null;
}

/**
 * Reads a runtime event stream and answers tool calls as they arrive.
 *
 * Split out of the orchestrator because three flows share it — a task run, a
 * goal step, and a resume after an inbox reply — and each must handle parking
 * and logging identically.
 */
@Injectable()
export class SessionConsumer {
  constructor(
    private readonly sessions: SessionsService,
    private readonly toolHandler: AgentToolHandler,
  ) {}

  async consume(input: {
    runner: Runner;
    handle: RunnerHandle;
    sessionId: string;
    ctx: ToolContext;
    seen: Set<string>;
    /** Wall-clock cut-off for this run; the caller destroys what is left. */
    deadlineAt?: Date | null;
    /** Revocation from the caller — a goal that lost its dispatch lease. */
    signal?: AbortSignal | null;
  }): Promise<ConsumeResult> {
    const { runner, handle, sessionId, ctx, seen } = input;
    const lines: string[] = [];
    let parked = false;
    let failure: string | null = null;

    // The signal is handed to the backend, which hands it to its own request.
    // Cancellation has to reach the socket: a session that stopped emitting is
    // exactly the one that cannot be stopped by abandoning the iterator.
    const cancellation = new RunCancellation(input.deadlineAt ?? null, input.signal);

    try {
      for await (let event of runner.streamEvents(handle, seen, cancellation.signal)) {
        if (event.kind === "log") {
          await this.log(sessionId, {
            type: event.type,
            name: event.name,
            summary: event.summary,
            eventId: event.eventId,
          });
          if (event.type === "agent.message" && event.summary) {
            // The same scrub the log gets. These lines become the session
            // summary, which is written verbatim into `goals.progress_log` and
            // handed back to the resumer — a credential echoed into a final
            // agent message was landing there while the log stayed clean.
            lines.push(redactRegistered(event.summary));
          }
          continue;
        }

        if (event.kind === "error") {
          // Also the string teardown writes into `sessions.error`.
          failure = redactRegistered(event.message);
          await this.log(sessionId, {
            type: "session.error",
            name: null,
            summary: failure,
            eventId: null,
          });
          continue;
        }

        if (event.kind === "tool-call") {
          // The handler runs on the *original* arguments. Scrubbing them first
          // was a real bug in the other direction: a registered value of
          // `production` rewrote `fs_read {path:"/production/report"}` into a
          // path that does not exist, and the same collision can invalidate a
          // sha or corrupt file content. Execution needs what the agent said;
          // only the record needs sanitising, and the two are now separate
          // objects rather than one that has to satisfy both.
          const outcome = await this.toolHandler.handle(ctx, event.call, cancellation.signal);
          // Scrubbed before the cut, so a long credential cannot leave its
          // front half behind for the exact-value replacement to miss.
          const summary =
            outcome.kind === "park"
              ? "parked — waiting on the operator"
              : redactRegistered(outcome.text).slice(0, 200);
          await this.log(sessionId, {
            type: "agent.custom_tool_use",
            // The arguments are recorded here, scrubbed — this is the copy
            // that reaches the database and the viewer.
            name: event.call.name,
            summary,
            eventId: event.eventId,
          });
          lines.push(`${redactRegistered(event.call.name)}: ${summary}`);

          if (outcome.kind === "park") {
            parked = true;
            await this.sessions.setStatus(sessionId, "waiting-inbox");
            break;
          }
          await runner.injectToolResult(handle, event.call.toolUseId, outcome.text);
          continue;
        }

        if (event.kind === "idle" || event.kind === "terminated") {
          await this.log(sessionId, {
            type: event.kind === "idle" ? "session.status_idle" : "session.status_terminated",
            name: null,
            summary: event.kind === "idle" ? event.stopReason : "terminated",
            eventId: null,
          });
        }
      }
    } catch (error) {
      // Aborting a live request rejects the pending read, so the expected end
      // of a cancelled run arrives as a throw. Only ours is swallowed.
      if (!(cancellation.cancelled && isAbortError(error))) {
        throw error;
      }
    } finally {
      cancellation.dispose();
    }

    if (cancellation.cancelled && !parked) {
      failure = failure ?? CANCEL_REASONS[cancellation.reason ?? "deadline"];
      await this.log(sessionId, {
        type: "session.error",
        name: null,
        summary: failure,
        eventId: null,
      });
    }
    return { parked, failure, summary: lines.join("\n") };
  }

  /**
   * The one place a runner's words become a stored record — so the one place
   * worth scrubbing them.
   *
   * The local worker redacts its own events before sending them, but the cloud
   * runtime's are provider-controlled and arrive verbatim: a tool name, an
   * error message, or an agent message can carry a credential an MCP server
   * echoed back at it, and from here it reaches `tool_call_log`, the session
   * API and the viewer. `redactRegistered` removes every secret this process
   * has actually resolved, which is exactly the set that could have been sent
   * to such a server.
   */
  private async log(sessionId: string, entry: Omit<ToolCallLogEntry, "at">): Promise<void> {
    await this.sessions.appendToolCalls(sessionId, [
      {
        at: new Date().toISOString(),
        ...entry,
        name: entry.name === null ? null : redactRegistered(entry.name),
        summary: redactRegistered(entry.summary),
      },
    ]);
  }
}
