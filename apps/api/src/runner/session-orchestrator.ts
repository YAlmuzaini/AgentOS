import { isTerminalSessionStatus } from "@agentos/shared";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { type AgentRow, AgentsService } from "../agents/agents.service";
import { GoalLogService } from "../goals/goal-log.service";
import { InboxService } from "../inbox/inbox.service";
import { SessionQueue } from "../queue/session.queue";
import { SessionsService } from "../sessions/sessions.service";
import { type TaskRow, TasksService } from "../tasks/tasks.service";
import { LocalVmRunner } from "./local-runner";
import { RunnerRouter } from "./runner-router";
import { SessionProvisioner } from "./session-provisioner";
import { SessionTeardown } from "./session-teardown";
import { type Runner, type RunnerHandle, RUNNER_CLOUD } from "./runner.types";
import { SessionConsumer } from "./session-consumer";
import type { ToolContext } from "./tool-handler";


/**
 * Drives the session state machine of SPEC §6:
 *   requested -> provision -> running -> [waiting-inbox] -> destroy.
 *
 * The container is destroyed on every exit path, success or failure, and the
 * tool-call log is persisted before that happens. The one path that does not
 * destroy is parking on an inbox question — that container has to survive
 * until the operator answers.
 */
@Injectable()
export class SessionOrchestrator {
  private readonly logger = new Logger(SessionOrchestrator.name);

  constructor(
    private readonly agents: AgentsService,
    private readonly tasks: TasksService,
    private readonly sessions: SessionsService,
    private readonly inbox: InboxService,
    private readonly consumer: SessionConsumer,
    private readonly provisioner: SessionProvisioner,
    private readonly router: RunnerRouter,
    @Inject(RUNNER_CLOUD) private readonly cloudRunner: Runner,
    private readonly localRunner: LocalVmRunner,
    private readonly teardown: SessionTeardown,
    private readonly goalLog: GoalLogService,
    private readonly queue: SessionQueue,
  ) {}

  async runTask(taskId: string): Promise<void> {
    const task = await this.tasks.requireById(taskId);
    if (!task.assigneeAgentId) {
      throw new Error(`task ${taskId} has no assigned agent`);
    }
    const agent = await this.agents.requireById(task.assigneeAgentId);
    const requested = await this.router.pick({ agent });
    const session = await this.sessions.create({
      projectId: task.projectId,
      agentId: agent.id,
      taskId: task.id,
      runner: requested.name,
    });

    let handle: RunnerHandle | null = null;
    let runner = requested;
    try {
      await this.tasks.setStatusFromAgent(task.id, "doing");
      ({ runner, handle } = await this.provisionWithFallback({
        agent,
        task,
        runner,
        sessionId: session.id,
        budgetUsd: null,
      }));
      await this.sessions.attachRuntime(
        session.id,
        handle.runtimeSessionId,
        handle.traceUrl,
        handle.vaultIds ?? [],
      );

      const result = await this.consumer.consume({
        runner,
        handle,
        sessionId: session.id,
        ctx: this.toolContext(session.id, task.projectId, agent, task.id, null),
        seen: new Set<string>(),
      });

      if (result.parked) {
        return;
      }
      await this.teardown.finish(runner, handle, session.id, result.failure);
    } catch (error) {
      await this.teardown.failAndRelease(runner, handle, session.id, error);
    }
  }

  /**
   * One specialist turn of a goal (SPEC §11). There is no card to move: the
   * session's output is what it writes to the shared progress log, which is
   * what the orchestrator reads before deciding who runs next.
   */
  async runGoalStep(input: {
    goalId: string;
    projectId: string;
    agentName: string;
    brief: string;
    budgetUsd: number | null;
    runnerPreference?: "cloud" | "local" | "auto" | null;
  }): Promise<{ sessionId: string; summary: string; costUsd: number | null; parked: boolean }> {
    const agent = await this.agents.requireByName(input.projectId, input.agentName);
    const requested = await this.router.pick({ agent, goalPreference: input.runnerPreference });
    const session = await this.sessions.create({
      projectId: input.projectId,
      agentId: agent.id,
      goalId: input.goalId,
      runner: requested.name,
    });

    let handle: RunnerHandle | null = null;
    let runner = requested;
    try {
      ({ runner, handle } = await this.provisionWithFallback({
        agent,
        task: null,
        runner,
        sessionId: session.id,
        kickoff: input.brief,
        budgetUsd: input.budgetUsd,
      }));
      await this.sessions.attachRuntime(
        session.id,
        handle.runtimeSessionId,
        handle.traceUrl,
        handle.vaultIds ?? [],
      );

      const result = await this.consumer.consume({
        runner,
        handle,
        sessionId: session.id,
        ctx: this.toolContext(session.id, input.projectId, agent, null, input.goalId),
        seen: new Set<string>(),
      });

      const costUsd = result.parked ? null : await this.teardown.finish(runner, handle, session.id, result.failure);
      // `parked` has to reach the caller. A goal that treats a parked turn as a
      // finished one dispatches the next specialist while the previous
      // container is still holding a question — two containers, one of them
      // waiting on a human who has not been asked yet.
      return { sessionId: session.id, summary: result.summary, costUsd, parked: result.parked };
    } catch (error) {
      await this.teardown.failAndRelease(runner, handle, session.id, error);
      return {
        sessionId: session.id,
        summary: `session failed: ${String(error)}`,
        costUsd: null,
        parked: false,
      };
    }
  }

  /** Called after the operator answers an inbox question. */
  async resumeSession(sessionId: string, inboxMessageId: string): Promise<void> {
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
        ctx: this.toolContext(session.id, session.projectId, agent, session.taskId, session.goalId),
        seen,
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
          await this.queue.enqueueGoalIteration(session.goalId);
        }
      }
    } catch (error) {
      await this.teardown.failAndRelease(runner, handle, session.id, error);
    }
  }

  /**
   * Provisions, falling back to the cloud when the local worker will not take
   * the work.
   *
   * The local worker refuses a session whose agent needs a limited network,
   * because it cannot enforce egress. `auto` routing does not know that in
   * advance, so without this a healthy local worker turns every restricted
   * session into a failure instead of a cloud run — the opposite of what
   * "prefers local, falls back to cloud" promises.
   */
  private async provisionWithFallback(input: {
    agent: AgentRow;
    task: TaskRow | null;
    runner: Runner;
    sessionId: string;
    kickoff?: string;
    budgetUsd: number | null;
  }): Promise<{ runner: Runner; handle: RunnerHandle }> {
    const onVaultsCreated = (vaultIds: string[]) =>
      this.sessions.recordVaults(input.sessionId, vaultIds);
    try {
      const handle = await this.provisioner.provision({ ...input, onVaultsCreated });
      return { runner: input.runner, handle };
    } catch (error) {
      if (input.runner.name !== "local") {
        throw error;
      }
      this.logger.warn(
        `local runner would not take session ${input.sessionId} (${String(error)}); using cloud`,
      );
      await this.sessions.setRunner(input.sessionId, "cloud");
      const handle = await this.provisioner.provision({
        ...input,
        runner: this.cloudRunner,
        onVaultsCreated,
      });
      return { runner: this.cloudRunner, handle };
    }
  }

  private toolContext(
    sessionId: string,
    projectId: string,
    agent: AgentRow,
    taskId: string | null,
    goalId: string | null,
  ): ToolContext {
    return {
      sessionId,
      projectId,
      agentId: agent.id,
      agentSlug: agent.name,
      taskId,
      goalId,
      inboxAccess: agent.inboxAccess,
      filesystemGrants: agent.filesystemGrants,
    };
  }
}
