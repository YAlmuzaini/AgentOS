import {
  MCP_CATALOG,
  type McpSeed,
  type UpdateMcpConnectionInput,
  updateMcpConnectionSchema,
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
import { CatalogService } from "./catalog.service";
import { DeletionService } from "./deletion.service";
import { EnvironmentsService } from "./environments.service";

/** One controller for the grantable catalog; the services stay separate. */
@Controller("projects/:projectId")
@UseGuards(OperatorGuard)
export class ResourcesController {
  constructor(
    private readonly environments: EnvironmentsService,
    private readonly catalog: CatalogService,
    private readonly deletion: DeletionService,
  ) {}

  /* ── Removal ────────────────────────────────────────────────────────────
     Each of these strips the deleted id out of every agent that granted it,
     so an agent's screen never lists a resource that no longer exists. */

  @Delete("environments/:id")
  removeEnvironment(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.deletion.removeEnvironment(projectId, id);
  }

  @Delete("repos/:id")
  removeRepo(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.deletion.removeRepo(projectId, id);
  }

  @Delete("mcp-connections/:id")
  removeMcp(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.deletion.removeMcp(projectId, id);
  }

  @Post("skills/install-built-ins")
  installBuiltInSkills(
    @Param("projectId", ParseUUIDPipe) projectId: string,
  ): Promise<SkillDto[]> {
    return this.catalog.installBuiltInSkills(projectId);
  }

  @Delete("skills/:id")
  removeSkill(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.deletion.removeSkill(projectId, id);
  }

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

  /**
   * The shipped connections, as data rather than as rows.
   *
   * Static, but project-scoped like everything else on this controller so the
   * web app has one base path. It carries the hosts each server talks to and
   * the environment variable its credential is expected to live in, which is
   * what an operator needs before installing anything.
   */
  @Get("mcp-connections/catalog")
  mcpCatalog(): McpSeed[] {
    // The whole catalogue, including the entries `install-built-ins` skips, so
    // the UI can offer the billable and mutating ones with their warnings
    // rather than leaving the operator to find a URL elsewhere.
    return MCP_CATALOG;
  }

  @Post("mcp-connections/install-built-ins")
  installBuiltInMcp(
    @Param("projectId", ParseUUIDPipe) projectId: string,
  ): Promise<McpConnectionDto[]> {
    return this.catalog.installBuiltInMcp(projectId);
  }

  @Post("mcp-connections")
  createMcp(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Body(new ZodBody(createMcpConnectionSchema)) body: CreateMcpConnectionInput,
  ): Promise<McpConnectionDto> {
    return this.catalog.createMcp(projectId, body);
  }

  @Put("mcp-connections/:id")
  updateMcp(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodBody(updateMcpConnectionSchema)) body: UpdateMcpConnectionInput,
  ): Promise<McpConnectionDto> {
    return this.catalog.updateMcp(projectId, id, body);
  }

  /**
   * Handshakes with one connection, on the operator's explicit request.
   *
   * POST rather than GET: it reaches out to a third party carrying this
   * project's credential, and it writes the result. Nothing calls it
   * automatically.
   */
  @Post("mcp-connections/:id/verify")
  verifyMcp(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<McpConnectionDto> {
    return this.catalog.verifyMcp(projectId, id);
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
