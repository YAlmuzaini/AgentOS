import {
  type ApproveDodInput,
  approveDodSchema,
  type CreateGoalInput,
  createGoalSchema,
  type GoalDto,
} from "@agentos/shared";
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { OperatorGuard } from "../auth/operator.guard";
import { ZodBody } from "../common/zod-body.pipe";
import { GoalsService } from "./goals.service";

@Controller("projects/:projectId/goals")
@UseGuards(OperatorGuard)
export class GoalsController {
  constructor(private readonly goals: GoalsService) {}

  @Get()
  list(@Param("projectId", ParseUUIDPipe) projectId: string): Promise<GoalDto[]> {
    return this.goals.list(projectId);
  }

  @Post()
  create(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Body(new ZodBody(createGoalSchema)) body: CreateGoalInput,
  ): Promise<GoalDto> {
    return this.goals.create(projectId, body);
  }

  @Get(":id")
  get(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<GoalDto> {
    return this.goals.get(projectId, id);
  }

  /** The sign-off that starts the loop. Nothing spawns before it. */
  @Post(":id/approve-dod")
  approveDod(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodBody(approveDodSchema)) body: ApproveDodInput,
  ): Promise<GoalDto> {
    return this.goals.approveDod(projectId, id, body);
  }

  @Post(":id/pause")
  pause(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<GoalDto> {
    return this.goals.pause(projectId, id);
  }

  @Post(":id/resume")
  resume(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<GoalDto> {
    return this.goals.resume(projectId, id);
  }
}
