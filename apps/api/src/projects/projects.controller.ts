import {
  type CreateProjectInput,
  createProjectSchema,
  type ProjectDto,
  type UpdateProjectInput,
  updateProjectSchema,
} from "@agentos/shared";
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import { OperatorGuard } from "../auth/operator.guard";
import { ZodBody } from "../common/zod-body.pipe";
import { ProjectsService } from "./projects.service";

@Controller("projects")
@UseGuards(OperatorGuard)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(): Promise<ProjectDto[]> {
    return this.projects.list();
  }

  @Post()
  create(
    @Body(new ZodBody(createProjectSchema)) body: CreateProjectInput,
  ): Promise<ProjectDto> {
    return this.projects.create(body);
  }

  @Get(":id")
  get(@Param("id", ParseUUIDPipe) id: string): Promise<ProjectDto> {
    return this.projects.get(id);
  }

  @Put(":id")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodBody(updateProjectSchema)) body: UpdateProjectInput,
  ): Promise<ProjectDto> {
    return this.projects.update(id, body);
  }

  @Delete(":id")
  remove(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    return this.projects.remove(id);
  }
}
