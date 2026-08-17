import {
  type AgentDto,
  CATALOG_PACKS,
  type CatalogPack,
  type CreateAgentInput,
  createAgentSchema,
  type UpdateAgentInput,
  updateAgentSchema,
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
import { DeletionService } from "../resources/deletion.service";
import { AgentsService } from "./agents.service";

@Controller("projects/:projectId/agents")
@UseGuards(OperatorGuard)
export class AgentsController {
  constructor(
    private readonly agents: AgentsService,
    private readonly deletion: DeletionService,
  ) {}

  /**
   * Puts the built-in role agents into this project (SPEC §4).
   *
   * A fresh project starts with nothing, and the fourteen roles the feature
   * template depends on are the same in every project — retyping them is not
   * configuration, it is transcription. Idempotent by name: running it twice
   * refreshes the shipped prompts and leaves an agent you edited alone in
   * everything else.
   */
  @Post("install-built-ins")
  installBuiltIns(@Param("projectId", ParseUUIDPipe) projectId: string): Promise<AgentDto[]> {
    return this.agents.installBuiltIns(projectId);
  }

  /** The packs, as data. Static, project-scoped for one base path in the UI. */
  @Get("packs")
  packs(): CatalogPack[] {
    return CATALOG_PACKS;
  }

  /**
   * Installs one pack's roles. Same installer, same provenance rules — a pack
   * is a filter over the shipped catalogue, not a second way in.
   */
  @Post("packs/:slug/install")
  installPack(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("slug") slug: string,
  ): Promise<AgentDto[]> {
    return this.agents.installPack(projectId, slug);
  }

  @Get()
  list(@Param("projectId", ParseUUIDPipe) projectId: string): Promise<AgentDto[]> {
    return this.agents.list(projectId);
  }

  @Post()
  create(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Body(new ZodBody(createAgentSchema)) body: CreateAgentInput,
  ): Promise<AgentDto> {
    return this.agents.create(projectId, body);
  }

  @Get(":id")
  get(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<AgentDto> {
    return this.agents.get(projectId, id);
  }

  @Delete(":id")
  remove(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.deletion.removeAgent(projectId, id);
  }

  @Put(":id")
  update(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodBody(updateAgentSchema)) body: UpdateAgentInput,
  ): Promise<AgentDto> {
    return this.agents.update(projectId, id, body);
  }
}
