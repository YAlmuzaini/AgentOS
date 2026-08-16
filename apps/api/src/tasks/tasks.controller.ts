import {
  type CreateTaskInput,
  createTaskSchema,
  type PatchTaskInput,
  patchTaskSchema,
  type TaskActivityDto,
  type TaskDto,
} from "@agentos/shared";
import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from "@nestjs/common";
import { OperatorGuard } from "../auth/operator.guard";
import { ZodBody } from "../common/zod-body.pipe";
import { SessionQueue } from "../queue/session.queue";
import { TasksService } from "./tasks.service";

@Controller("projects/:projectId/tasks")
@UseGuards(OperatorGuard)
export class TasksController {
  constructor(
    private readonly tasks: TasksService,
    private readonly queue: SessionQueue,
  ) {}

  @Get()
  list(@Param("projectId", ParseUUIDPipe) projectId: string): Promise<TaskDto[]> {
    return this.tasks.list(projectId);
  }

  /** Scheduling is applied by the service, so every creation path behaves alike. */
  @Post()
  create(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Body(new ZodBody(createTaskSchema)) body: CreateTaskInput,
  ): Promise<TaskDto> {
    return this.tasks.create(projectId, body);
  }

  @Get(":id")
  get(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<TaskDto> {
    return this.tasks.get(projectId, id);
  }

  /** Operator edits. `actor: human` is what makes closing a gated card legal. */
  @Patch(":id")
  patch(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodBody(patchTaskSchema)) body: PatchTaskInput,
  ): Promise<TaskDto> {
    return this.tasks.patch(projectId, id, body, "human");
  }

  @Post(":id/run")
  async run(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<{ enqueued: true }> {
    const task = await this.tasks.require(projectId, id);
    if (task.assigneeType !== "agent" || !task.assigneeAgentId) {
      throw new BadRequestException("task is not assigned to an agent");
    }
    await this.queue.enqueueRun(task.id);
    return { enqueued: true };
  }

  /** Removing a task the operator no longer wants. */
  @Delete(":id")
  @HttpCode(204)
  remove(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.tasks.remove(projectId, id);
  }

  @Get(":id/activity")
  async activity(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<TaskActivityDto[]> {
    await this.tasks.require(projectId, id);
    return this.tasks.listActivity(id);
  }
}
