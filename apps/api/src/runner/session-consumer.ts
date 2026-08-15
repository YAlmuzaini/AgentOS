import type { ToolCallLogEntry } from "@agentos/shared";
import { Injectable } from "@nestjs/common";
import { SessionsService } from "../sessions/sessions.service";
import { isAbortError, RunCancellation } from "./run-cancellation";
import type { Runner, RunnerHandle } from "./runner.types";
import { AgentToolHandler, type ToolContext } from "./tool-handler";

/** What the session log says when a run was cut off rather than finished. */
const CANCEL_REASONS = {
  deadline: "the goal's time limit ran out while this session was still running",
  revoked: "this goal handed its turn to another dispatch; the session was stopped",
} as const;

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
      for await (const event of runner.streamEvents(handle, seen, cancellation.signal)) {
        if (event.kind === "log") {
          await this.log(sessionId, {
            type: event.type,
            name: event.name,
            summary: event.summary,
            eventId: event.eventId,
          });
          if (event.type === "agent.message" && event.summary) {
            lines.push(event.summary);
          }
          continue;
        }

        if (event.kind === "error") {
          failure = event.message;
          await this.log(sessionId, {
            type: "session.error",
            name: null,
            summary: event.message,
            eventId: null,
          });
          continue;
        }

        if (event.kind === "tool-call") {
          const outcome = await this.toolHandler.handle(ctx, event.call);
          const summary =
            outcome.kind === "park"
              ? "parked — waiting on the operator"
              : outcome.text.slice(0, 200);
          await this.log(sessionId, {
            type: "agent.custom_tool_use",
            name: event.call.name,
            summary,
            eventId: event.eventId,
          });
          lines.push(`${event.call.name}: ${summary}`);

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

  private async log(sessionId: string, entry: Omit<ToolCallLogEntry, "at">): Promise<void> {
    await this.sessions.appendToolCalls(sessionId, [{ at: new Date().toISOString(), ...entry }]);
  }
}
