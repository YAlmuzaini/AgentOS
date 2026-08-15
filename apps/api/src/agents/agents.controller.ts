import {
  type AgentDto,
  type CreateAgentInput,
  createAgentSchema,
  type UpdateAgentInput,
  updateAgentSchema,
} from "@agentos/shared";
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, UseGuards } from "@nestjs/common";
import { OperatorGuard } from "../auth/operator.guard";
import { ZodBody } from "../common/zod-body.pipe";
import { AgentsService } from "./agents.service";

@Controller("projects/:projectId/agents")
@UseGuards(OperatorGuard)
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

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

  @Put(":id")
  update(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodBody(updateAgentSchema)) body: UpdateAgentInput,
  ): Promise<AgentDto> {
    return this.agents.update(projectId, id, body);
  }
}
