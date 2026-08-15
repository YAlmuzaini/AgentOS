import { type Database, taskActivity, tasks } from "@agentos/db";
import type {
  CreateTaskInput,
  PatchTaskInput,
  TaskActivityDto,
  TaskDto,
  TaskStatus,
} from "@agentos/shared";
import { ForbiddenException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { and, asc, eq, ne } from "drizzle-orm";
import { AgentsService } from "../agents/agents.service";
import { DATABASE } from "../db/db.module";
import { ProjectsService } from "../projects/projects.service";
import { SessionQueue } from "../queue/session.queue";
import { activityToDto, toDto } from "./task-dto";

export type TaskRow = typeof tasks.$inferSelect;
export { toDto } from "./task-dto";

/** Who is asking. Agent-scoped writes are refused on approval-gated tasks. */
export type Actor = "human" | "agent";

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly projects: ProjectsService,
    private readonly agents: AgentsService,
    private readonly queue: SessionQueue,
  ) {}

  async list(projectId: string): Promise<TaskDto[]> {
    await this.projects.require(projectId);
    const rows = await this.db
      .select()
      .from(tasks)
      .where(eq(tasks.projectId, projectId))
      .orderBy(asc(tasks.createdAt));
    return rows.map(toDto);
  }

  async create(projectId: string, input: CreateTaskInput): Promise<TaskDto> {
    return this.createInternal(projectId, input, { autoStart: true });
  }

  /**
   * Creates a task that belongs to a template chain. Chained tasks do not
   * start on creation: only step 0 is released, and each later step waits for
   * its predecessor to reach `done` (SPEC §9.4).
   */
  async createChained(
    projectId: string,
    input: CreateTaskInput,
    chain: { chainId: string; chainIndex: number; templateId: string },
  ): Promise<TaskDto> {
    return this.createInternal(projectId, input, { autoStart: false, chain });
  }

  private async createInternal(
    projectId: string,
    input: CreateTaskInput,
    options: {
      autoStart: boolean;
      chain?: { chainId: string; chainIndex: number; templateId: string };
    },
  ): Promise<TaskDto> {
    await this.projects.require(projectId);
    if (input.assigneeAgentId) {
      await this.agents.require(projectId, input.assigneeAgentId);
    }
    const [row] = await this.db
      .insert(tasks)
      .values({ ...input, projectId, ...(options.chain ?? {}) })
      .returning();

    const task = toDto(row!);
    if (options.autoStart) {
      try {
        await this.applySchedule(task);
      } catch (error) {
        // The row is committed but nothing will ever run it. Leaving it behind
        // turns a caller's retry into two cards, one of them permanently
        // inert, so the failed creation is undone entirely.
        await this.db.delete(tasks).where(eq(tasks.id, task.id));
        throw error;
      }
    }
    return task;
  }

  /**
   * Turns the task's schedule into queue work. `now` runs immediately, `at`
   * runs once with a delay, `cron` installs a repeating scheduler keyed by the
   * task id so re-saving replaces rather than duplicates it (SPEC §9.2).
   */
  async applySchedule(task: TaskDto): Promise<void> {
    if (task.assigneeType !== "agent" || !task.assigneeAgentId) {
      return;
    }
    switch (task.scheduleKind) {
      case "now":
        await this.queue.enqueueRun(task.id);
        return;
      case "at":
        if (task.runAt) {
          await this.queue.enqueueRunAt(task.id, new Date(task.runAt));
        }
        return;
      case "cron":
        if (task.cron && task.timezone) {
          await this.queue.scheduleCron(task.id, task.cron, task.timezone);
        }
        return;
    }
  }

  async get(projectId: string, id: string): Promise<TaskDto> {
    return toDto(await this.require(projectId, id));
  }

  async patch(
    projectId: string,
    id: string,
    input: PatchTaskInput,
    actor: Actor = "human",
  ): Promise<TaskDto> {
    const current = await this.require(projectId, id);
    if (input.status) {
      this.assertStatusAllowed(current, input.status, actor);
    }
    if (input.assigneeAgentId) {
      await this.agents.require(projectId, input.assigneeAgentId);
    }
    // Closing a card is a *claim*, not a write. The predicate — not the status
    // read above — decides whether this call is the one that closed it, so of
    // two concurrent completions exactly one releases the next step, and a
    // card reopened between the read and the write is still claimed correctly.
    const closing = input.status === "done";
    const [row] = await this.db
      .update(tasks)
      .set({ ...input, updatedAt: new Date() })
      .where(closing ? and(eq(tasks.id, id), ne(tasks.status, "done")) : eq(tasks.id, id))
      .returning();

    if (!row) {
      // It was already done. That caller owns the release; this one just
      // reports the card as it now stands.
      return toDto(await this.require(projectId, id));
    }

    const updated = toDto(row);
    if (closing) {
      await this.advanceChain(updated);
    }
    return updated;
  }

  /**
   * The approval gate (SPEC §5.9). An agent-scoped caller can move a gated
   * card into review but can never close it — only the operator can.
   */
  private assertStatusAllowed(task: TaskRow, next: TaskStatus, actor: Actor): void {
    if (actor === "agent" && task.approvalGate && next === "done") {
      throw new ForbiddenException(
        `task ${task.id} is approval-gated: an agent session cannot set status=done`,
      );
    }
  }

  /** Runner-side status write; carries the agent actor and its ACL. */
  async setStatusFromAgent(taskId: string, next: TaskStatus): Promise<TaskDto> {
    const task = await this.requireById(taskId);
    this.assertStatusAllowed(task, next, "agent");

    // The gate is re-asserted *in* the update, not just before it. Checking a
    // row and then writing it unconditionally leaves a window in which the
    // operator turns the gate on and an agent still closes the card; the
    // predicate closes that window in the database, where it belongs.
    const closing = next === "done";
    const [row] = await this.db
      .update(tasks)
      .set({ status: next, updatedAt: new Date() })
      .where(
        closing
          ? and(eq(tasks.id, taskId), ne(tasks.status, "done"), eq(tasks.approvalGate, false))
          : eq(tasks.id, taskId),
      )
      .returning();

    if (!row) {
      const now = await this.requireById(taskId);
      if (closing && now.approvalGate) {
        throw new ForbiddenException(
          `task ${taskId} is approval-gated: an agent session cannot set status=done`,
        );
      }
      // Already done — another caller owns the release.
      return toDto(now);
    }

    const updated = toDto(row);
    if (closing) {
      await this.advanceChain(updated);
    }
    return updated;
  }

  /**
   * Releases the next step of a template chain. This is the only way a later
   * step starts, which is what makes an approval gate a hard stop: a gated
   * card can only be closed by the operator, so nothing downstream of it moves
   * until they do (SPEC §9.3, §9.4).
   */
  private async advanceChain(task: TaskDto): Promise<void> {
    if (!task.chainId || task.chainIndex === null) {
      return;
    }
    const next = await this.db.query.tasks.findFirst({
      where: and(eq(tasks.chainId, task.chainId), eq(tasks.chainIndex, task.chainIndex + 1)),
    });
    if (!next) {
      return;
    }
    if (next.assigneeType !== "agent" || !next.assigneeAgentId) {
      // A human step simply sits on the board waiting for the operator.
      this.logger.log(`chain ${task.chainId} reached a human step: ${next.name}`);
      return;
    }
    // Keyed by the step being released: if two callers ever reach here for
    // the same step, the queue keeps one job rather than starting two agents.
    //
    // A failure here leaves the predecessor `done` and the successor waiting
    // with no job — the card is already committed, so this cannot be undone by
    // throwing. `releaseStalledChains` is what finds it later.
    try {
      await this.queue.enqueueRun(next.id, `chain-release-${next.id}`);
    } catch (error) {
      this.logger.error(
        `chain ${task.chainId}: step "${next.name}" was released but could not be queued ` +
          `(${String(error)}); maintenance will retry it`,
      );
    }
  }

  async addActivity(input: {
    taskId: string;
    sessionId?: string | null;
    agentId?: string | null;
    body: string;
  }): Promise<TaskActivityDto> {
    const [row] = await this.db
      .insert(taskActivity)
      .values({
        taskId: input.taskId,
        sessionId: input.sessionId ?? null,
        agentId: input.agentId ?? null,
        body: input.body,
      })
      .returning();
    return activityToDto(row!);
  }

  async listActivity(taskId: string): Promise<TaskActivityDto[]> {
    const rows = await this.db
      .select()
      .from(taskActivity)
      .where(eq(taskActivity.taskId, taskId))
      .orderBy(asc(taskActivity.createdAt));
    return rows.map(activityToDto);
  }

  async require(projectId: string, id: string): Promise<TaskRow> {
    const row = await this.db.query.tasks.findFirst({
      where: and(eq(tasks.projectId, projectId), eq(tasks.id, id)),
    });
    if (!row) {
      throw new NotFoundException(`task ${id} not found in project ${projectId}`);
    }
    return row;
  }

  async requireById(id: string): Promise<TaskRow> {
    const row = await this.db.query.tasks.findFirst({ where: eq(tasks.id, id) });
    if (!row) {
      throw new NotFoundException(`task ${id} not found`);
    }
    return row;
  }
}
