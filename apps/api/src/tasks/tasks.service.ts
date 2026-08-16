import { type Database, sessions, taskActivity, tasks } from "@agentos/db";
import { TERMINAL_SESSION_STATUSES } from "@agentos/shared";
import type {
  CreateTaskInput,
  PatchTaskInput,
  TaskActivityDto,
  TaskDto,
  TaskStatus,
} from "@agentos/shared";
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, eq, ne, notInArray, sql } from "drizzle-orm";
import { AgentsService } from "../agents/agents.service";
import { DATABASE } from "../db/db.module";
import { FilesService } from "../files/files.service";
import { ProjectsService } from "../projects/projects.service";
import { SessionQueue } from "../queue/session.queue";
import { releaseNextStep } from "./chain-release";
import { activityToDto, toDto } from "./task-dto";
import { removeTask } from "./task-removal";
import { applySchedule } from "./task-schedule";

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
    private readonly files: FilesService,
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

  /**
   * Creates a card one agent asked another to work (SPEC §5.10).
   *
   * The caller has already checked the target against the spawning agent's
   * collaboration list; this records the lineage so the parent can read the
   * result back and the depth ceiling has something to count.
   */
  async createSpawned(
    projectId: string,
    input: CreateTaskInput,
    lineage: {
      parentTaskId: string | null;
      spawnedByAgentId: string;
      spawnedBySessionId: string;
      spawnDepth: number;
    },
  ): Promise<TaskDto> {
    return this.createInternal(projectId, input, { autoStart: true, lineage });
  }

  /** How many cards one session has already spawned, for the per-session cap. */
  async countSpawnedBySession(sessionId: string): Promise<number> {
    const rows = await this.db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.spawnedBySessionId, sessionId));
    return rows.length;
  }

  private async createInternal(
    projectId: string,
    input: CreateTaskInput,
    options: {
      autoStart: boolean;
      chain?: { chainId: string; chainIndex: number; templateId: string };
      lineage?: {
        parentTaskId: string | null;
        spawnedByAgentId: string;
        spawnedBySessionId: string;
        spawnDepth: number;
      };
    },
  ): Promise<TaskDto> {
    await this.projects.require(projectId);
    if (input.assigneeAgentId) {
      await this.agents.require(projectId, input.assigneeAgentId);
    }
    const [row] = await this.db
      .insert(tasks)
      .values({ ...input, projectId, ...(options.chain ?? {}), ...(options.lineage ?? {}) })
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

  /** Turns the task's schedule into queue work; see `task-schedule.ts`. */
  applySchedule(task: TaskDto): Promise<void> {
    return applySchedule(this.queue, task);
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
    if (input.attachmentIds) {
      // An id from another project resolves to no path, so the session would
      // silently get an attachment it cannot see. Refuse it here instead.
      const found = await this.files.pathsByIds(projectId, input.attachmentIds);
      if (found.length !== input.attachmentIds.length) {
        throw new BadRequestException("one or more attachments are not files in this project");
      }
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
      await releaseNextStep(this.db, this.queue, this.logger, updated);
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
      await releaseNextStep(this.db, this.queue, this.logger, updated);
    }
    return updated;
  }

  /**
   * Adds a file to a task's attachments, idempotently and atomically.
   *
   * One statement, because two of them are a lost update: a spawned reviewer
   * attaching its report while the coordinator attaches the consolidated one
   * would have had each read the same list and written its own over the
   * other's. The `@>` guard is what keeps it a set.
   */
  async attach(taskId: string, fileId: string): Promise<string[]> {
    const [row] = await this.db
      .update(tasks)
      .set({
        attachmentIds: sql`${tasks.attachmentIds} || ${JSON.stringify([fileId])}::jsonb`,
        updatedAt: new Date(),
      })
      .where(
        and(eq(tasks.id, taskId), sql`NOT (${tasks.attachmentIds} @> ${JSON.stringify([fileId])}::jsonb)`),
      )
      .returning({ attachmentIds: tasks.attachmentIds });

    // No row means it was already attached — by this session or another.
    return row?.attachmentIds ?? (await this.requireById(taskId)).attachmentIds;
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

  /** Removing a task; the rules live in `task-removal.ts`. */
  async remove(projectId: string, id: string): Promise<void> {
    await removeTask(this.db, this.queue, await this.require(projectId, id));
  }

  async requireById(id: string): Promise<TaskRow> {
    const row = await this.db.query.tasks.findFirst({ where: eq(tasks.id, id) });
    if (!row) {
      throw new NotFoundException(`task ${id} not found`);
    }
    return row;
  }
}
