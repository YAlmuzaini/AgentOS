import { isTerminalSessionStatus } from "@agentos/shared";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { AgentsService } from "../agents/agents.service";
import { DispatchLease } from "../goals/dispatch-lease";
import { GoalLogService } from "../goals/goal-log.service";
import { GoalLeases } from "../goals/goal-leases";
import { InboxService } from "../inbox/inbox.service";
import { SessionQueue } from "../queue/session.queue";
import { SessionsService } from "../sessions/sessions.service";
import { LocalVmRunner } from "./local-runner";
import { type Runner, type RunnerHandle, RUNNER_CLOUD } from "./runner.types";
import { SessionConsumer } from "./session-consumer";
import { SessionTeardown } from "./session-teardown";
import { toolContext } from "./tool-context";

/**
 * Picking a parked session back up after the operator answers.
 *
 * Split from the orchestrator because the rules are its own: the run is already
 * half-finished, its container is still alive, and its goal is waiting on this
 * turn to end before anything else can happen. Both halves of that turn have to
 * be accounted for — the spend from before the question and the spend from
 * after it — and the loop has to be handed back whichever way the second half
 * goes, or the goal simply stops existing as far as the queue is concerned.
 */
@Injectable()
export class SessionResumer {
  private readonly logger = new Logger(SessionResumer.name);

  constructor(
    private readonly agents: AgentsService,
    private readonly sessions: SessionsService,
    private readonly inbox: InboxService,
    private readonly consumer: SessionConsumer,
    @Inject(RUNNER_CLOUD) private readonly cloudRunner: Runner,
    private readonly localRunner: LocalVmRunner,
    private readonly teardown: SessionTeardown,
    private readonly goalLog: GoalLogService,
    private readonly queue: SessionQueue,
    private readonly leases: GoalLeases,
  ) {}

  async resume(sessionId: string, inboxMessageId: string): Promise<void> {
    const session = await this.sessions.require(sessionId);
    // The answer claimed this session out of `waiting-inbox` before the job was
    // queued, so `running` is the expected state here. A terminal one means the
    // reaper or a failure got there first.
    if (isTerminalSessionStatus(session.status) || !session.runtimeHandle) {
      this.logger.warn(`session ${sessionId} is ${session.status}; nothing to resume`);
      return;
    }

    const message = await this.inbox.require(inboxMessageId);
    if (!message.runtimeToolUseId) {
      this.logger.warn(`inbox message ${inboxMessageId} has no parked tool call`);
      return;
    }

    const agent = await this.agents.requireById(session.agentId);
    // Resume on the backend that started the run: the handle only means
    // something there.
    const runner = session.runner === "local" ? this.localRunner : this.cloudRunner;
    const handle: RunnerHandle = {
      runtimeSessionId: session.runtimeHandle,
      traceUrl: session.traceUrl,
      // Carried across the park so the eventual destroy still deletes the
      // vaults this session's credentials live in.
      vaultIds: session.runtimeVaultIds,
    };

    // A resumed turn is a dispatch, and it has to hold the goal's slot like
    // any other. Without this its session looked idle to recovery once it was
    // older than a lease window, so maintenance could launch a second
    // specialist against the same remaining budget while this one ran on.
    const lease = session.goalId ? await this.claimLease(session.goalId) : null;
    // Enqueued after the lease is released, never before: a successor picked up
    // by a free worker while this job still held the slot would lose the claim
    // and exit, leaving the goal with nothing queued at all.
    let queueNext: string | null = null;

    try {
      await runner.injectToolResult(handle, message.runtimeToolUseId, this.inbox.answerText(message));

      // Events already logged must not be re-processed after the reconnect.
      const seen = new Set(
        session.toolCallLog.map((entry) => entry.eventId).filter((id): id is string => Boolean(id)),
      );
      const result = await this.consumer.consume({
        runner,
        handle,
        sessionId: session.id,
        ctx: toolContext(session.id, session.projectId, agent, session.taskId, session.goalId),
        seen,
        // The rail applies to the whole goal, not to the half of the turn that
        // ran before the question. Without this a goal could park just inside
        // its limit and then run unbounded once answered.
        deadlineAt: await this.goalDeadline(session.goalId),
        // Revoked if the slot changes hands mid-turn.
        signal: lease?.signal ?? null,
      });

      if (!result.parked) {
        const costUsd = await this.teardown.finish(runner, handle, session.id, result.failure);
        // The goal loop stopped when this session parked. Now that its answer
        // has landed and the turn is over, the loop is owed both the spend and
        // its next iteration — otherwise a goal quietly stalls forever the
        // first time a specialist asks a question.
        if (session.goalId) {
          if (costUsd !== null) {
            await this.goalLog.recordSpend(session.goalId, costUsd);
          }
          if (result.summary.trim()) {
            await this.goalLog.appendProgress(session.goalId, agent.name, result.summary);
          }
          // Only the slot holder queues the next turn. If the lease was
          // already taken, that holder owns the loop and a second enqueue here
          // would be the double-dispatch this lease exists to prevent.
          if (lease) {
            queueNext = session.goalId;
          }
        }
      }
    } catch (error) {
      // The cost has to be booked here too. The direct dispatch path charges a
      // failed specialist; a specialist that failed *after* being answered was
      // spending exactly the same money, and dropping it let the next
      // iteration read a budget that had already been spent.
      const costUsd = await this.teardown.failAndRelease(runner, handle, session.id, error);
      if (session.goalId) {
        if (costUsd !== null) {
          await this.goalLog.recordSpend(session.goalId, costUsd);
        }
        // The turn is over, badly. Hand the loop back rather than leaving the
        // goal active with nothing queued — recovery would take 15 minutes to
        // notice, and only if it noticed at all.
        await this.goalLog.appendProgress(
          session.goalId,
          agent.name,
          `the resumed session failed: ${String(error)}`,
        );
        if (lease) {
          queueNext = session.goalId;
        }
      }
    } finally {
      await lease?.release();
    }

    if (queueNext) {
      await this.queue.enqueueGoalIteration(queueNext);
    }
  }

  /**
   * Takes the goal's dispatch slot for the length of this resumed turn.
   *
   * Returns null when another dispatch already holds it. The container is real
   * and the operator has answered it, so the turn still runs — refusing would
   * strand a live session holding money already spent. What it does not do is
   * queue the next turn, because that belongs to whoever holds the slot.
   */
  private async claimLease(goalId: string): Promise<DispatchLease | null> {
    const token = await this.leases.claim(goalId);
    if (!token) {
      this.logger.warn(
        `goal ${goalId}: resuming a parked session while another dispatch holds the slot; ` +
          "this turn will not queue the next one",
      );
      return null;
    }
    return new DispatchLease(this.leases, goalId, token, this.logger);
  }

  /** The goal's absolute time rail, for a session being resumed into it. */
  private async goalDeadline(goalId: string | null): Promise<Date | null> {
    if (!goalId) {
      return null;
    }
    const rail = await this.goalLog.timeRail(goalId);
    if (!rail?.maxDurationMinutes || !rail.startedAt) {
      return null;
    }
    return new Date(rail.startedAt.getTime() + rail.maxDurationMinutes * 60_000);
  }

}
