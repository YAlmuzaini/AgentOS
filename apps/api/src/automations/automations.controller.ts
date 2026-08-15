import {
  type AutomationDto,
  type CreateAutomationInput,
  createAutomationSchema,
} from "@agentos/shared";
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { OperatorGuard } from "../auth/operator.guard";
import { ZodBody } from "../common/zod-body.pipe";
import { AutomationsService } from "./automations.service";

@Controller("projects/:projectId/automations")
@UseGuards(OperatorGuard)
export class AutomationsController {
  constructor(private readonly automations: AutomationsService) {}

  @Get()
  list(@Param("projectId", ParseUUIDPipe) projectId: string): Promise<AutomationDto[]> {
    return this.automations.list(projectId);
  }

  @Post()
  create(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Body(new ZodBody(createAutomationSchema)) body: CreateAutomationInput,
  ): Promise<AutomationDto> {
    return this.automations.create(projectId, body);
  }

  @Post(":id/enable")
  enable(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<AutomationDto> {
    return this.automations.setEnabled(projectId, id, true);
  }

  @Post(":id/disable")
  disable(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<AutomationDto> {
    return this.automations.setEnabled(projectId, id, false);
  }

  /** Fire now, so the operator can test a schedule without waiting for it. */
  @Post(":id/run")
  run(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<{ taskIds: string[] }> {
    return this.automations
      .require(projectId, id)
      .then((row) => this.automations.fire(row.id));
  }
}
