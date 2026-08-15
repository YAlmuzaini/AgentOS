import {
  type CreateEnvBindingInput,
  createEnvBindingSchema,
  type CreateEnvironmentInput,
  createEnvironmentSchema,
  type CreateMcpConnectionInput,
  createMcpConnectionSchema,
  type CreateRepoInput,
  createRepoSchema,
  type CreateSkillInput,
  createSkillSchema,
  type EnvBindingDto,
  type EnvironmentDto,
  type McpConnectionDto,
  type RepoDto,
  type SkillDto,
  type UpdateEnvironmentInput,
  updateEnvironmentSchema,
} from "@agentos/shared";
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, UseGuards } from "@nestjs/common";
import { OperatorGuard } from "../auth/operator.guard";
import { ZodBody } from "../common/zod-body.pipe";
import { CatalogService } from "./catalog.service";
import { EnvironmentsService } from "./environments.service";

/** One controller for the grantable catalog; the services stay separate. */
@Controller("projects/:projectId")
@UseGuards(OperatorGuard)
export class ResourcesController {
  constructor(
    private readonly environments: EnvironmentsService,
    private readonly catalog: CatalogService,
  ) {}

  @Get("environments")
  listEnvironments(@Param("projectId", ParseUUIDPipe) projectId: string): Promise<EnvironmentDto[]> {
    return this.environments.list(projectId);
  }

  @Post("environments")
  createEnvironment(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Body(new ZodBody(createEnvironmentSchema)) body: CreateEnvironmentInput,
  ): Promise<EnvironmentDto> {
    return this.environments.create(projectId, body);
  }

  @Put("environments/:id")
  updateEnvironment(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodBody(updateEnvironmentSchema)) body: UpdateEnvironmentInput,
  ): Promise<EnvironmentDto> {
    return this.environments.update(projectId, id, body);
  }

  @Get("mcp-connections")
  listMcp(@Param("projectId", ParseUUIDPipe) projectId: string): Promise<McpConnectionDto[]> {
    return this.catalog.listMcp(projectId);
  }

  @Post("mcp-connections")
  createMcp(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Body(new ZodBody(createMcpConnectionSchema)) body: CreateMcpConnectionInput,
  ): Promise<McpConnectionDto> {
    return this.catalog.createMcp(projectId, body);
  }

  @Get("repos")
  listRepos(@Param("projectId", ParseUUIDPipe) projectId: string): Promise<RepoDto[]> {
    return this.catalog.listRepos(projectId);
  }

  @Post("repos")
  createRepo(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Body(new ZodBody(createRepoSchema)) body: CreateRepoInput,
  ): Promise<RepoDto> {
    return this.catalog.createRepo(projectId, body);
  }

  @Get("skills")
  listSkills(@Param("projectId", ParseUUIDPipe) projectId: string): Promise<SkillDto[]> {
    return this.catalog.listSkills(projectId);
  }

  @Post("skills")
  createSkill(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Body(new ZodBody(createSkillSchema)) body: CreateSkillInput,
  ): Promise<SkillDto> {
    return this.catalog.createSkill(projectId, body);
  }

  @Get("env-bindings")
  listEnvBindings(@Param("projectId", ParseUUIDPipe) projectId: string): Promise<EnvBindingDto[]> {
    return this.catalog.listEnvBindings(projectId);
  }

  @Post("env-bindings")
  createEnvBinding(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Body(new ZodBody(createEnvBindingSchema)) body: CreateEnvBindingInput,
  ): Promise<EnvBindingDto> {
    return this.catalog.createEnvBinding(projectId, body);
  }
}
