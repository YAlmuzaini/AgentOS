import {
  type CreateTemplateInput,
  createTemplateSchema,
  type InstantiateTemplateInput,
  instantiateTemplateSchema,
  type TaskDto,
  type TaskTemplateDto,
} from "@agentos/shared";
import {
  Body, Controller,
  Delete, Get, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { OperatorGuard } from "../auth/operator.guard";
import { ZodBody } from "../common/zod-body.pipe";
import { TemplatesService } from "./templates.service";

@Controller("projects/:projectId/templates")
@UseGuards(OperatorGuard)
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get()
  list(@Param("projectId", ParseUUIDPipe) projectId: string): Promise<TaskTemplateDto[]> {
    return this.templates.list(projectId);
  }

  @Post()
  create(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Body(new ZodBody(createTemplateSchema)) body: CreateTemplateInput,
  ): Promise<TaskTemplateDto> {
    return this.templates.create(projectId, body);
  }

  /** Re-installs the built-in workflows over whatever is there. */
  @Post("install-built-ins")
  installBuiltIns(
    @Param("projectId", ParseUUIDPipe) projectId: string,
  ): Promise<TaskTemplateDto[]> {
    return this.templates.installBuiltIns(projectId);
  }

  @Post(":id/instantiate")
  instantiate(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodBody(instantiateTemplateSchema)) body: InstantiateTemplateInput,
  ): Promise<TaskDto[]> {
    return this.templates.instantiate(projectId, id, body);
  }

  @Delete(":id")
  remove(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.templates.remove(projectId, id);
  }
}
