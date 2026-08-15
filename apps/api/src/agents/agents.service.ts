import { agents, type Database } from "@agentos/db";
import {
  type AgentDto,
  type CreateAgentInput,
  FOUNDATIONAL_PROMPT,
  type UpdateAgentInput,
} from "@agentos/shared";
import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { DATABASE } from "../db/db.module";
import { ProjectsService } from "../projects/projects.service";

export type AgentRow = typeof agents.$inferSelect;

@Injectable()
export class AgentsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly projects: ProjectsService,
  ) {}

  async list(projectId: string): Promise<AgentDto[]> {
    await this.projects.require(projectId);
    const rows = await this.db
      .select()
      .from(agents)
      .where(eq(agents.projectId, projectId))
      .orderBy(agents.name);
    return rows.map(toDto);
  }

  async create(projectId: string, input: CreateAgentInput): Promise<AgentDto> {
    await this.projects.require(projectId);
    const clash = await this.db.query.agents.findFirst({
      where: and(eq(agents.projectId, projectId), eq(agents.name, input.name)),
    });
    if (clash) {
      throw new ConflictException(`agent "${input.name}" already exists in this project`);
    }

    const [row] = await this.db
      .insert(agents)
      .values({
        ...input,
        projectId,
        foundationalPrompt: input.foundationalPrompt ?? FOUNDATIONAL_PROMPT,
      })
      .returning();
    return toDto(row!);
  }

  async get(projectId: string, id: string): Promise<AgentDto> {
    return toDto(await this.require(projectId, id));
  }

  async update(projectId: string, id: string, input: UpdateAgentInput): Promise<AgentDto> {
    await this.require(projectId, id);
    const [row] = await this.db
      .update(agents)
      .set({
        ...input,
        // Any config edit invalidates the pinned runtime agent version; the
        // runner re-publishes on the next session (SPEC §4 Agent versioning).
        runtimeConfigHash: null,
        updatedAt: new Date(),
      })
      .where(eq(agents.id, id))
      .returning();
    return toDto(row!);
  }

  async require(projectId: string, id: string): Promise<AgentRow> {
    const row = await this.db.query.agents.findFirst({
      where: and(eq(agents.projectId, projectId), eq(agents.id, id)),
    });
    if (!row) {
      throw new NotFoundException(`agent ${id} not found in project ${projectId}`);
    }
    return row;
  }

  /** Non-throwing lookup, for callers that treat a missing role as "skip". */
  async findByName(projectId: string, name: string): Promise<AgentRow | undefined> {
    return this.db.query.agents.findFirst({
      where: and(eq(agents.projectId, projectId), eq(agents.name, name)),
    });
  }

  /** Dispatch by role name — how the goal orchestrator names a specialist. */
  async requireByName(projectId: string, name: string): Promise<AgentRow> {
    const row = await this.db.query.agents.findFirst({
      where: and(eq(agents.projectId, projectId), eq(agents.name, name)),
    });
    if (!row) {
      throw new NotFoundException(`agent "${name}" not found in project ${projectId}`);
    }
    return row;
  }

  /** Used by the runner, which knows the agent id but not the project. */
  async requireById(id: string): Promise<AgentRow> {
    const row = await this.db.query.agents.findFirst({ where: eq(agents.id, id) });
    if (!row) {
      throw new NotFoundException(`agent ${id} not found`);
    }
    return row;
  }
}

export function toDto(row: AgentRow): AgentDto {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    title: row.title,
    model: row.model,
    foundationalPrompt: row.foundationalPrompt,
    rolePrompt: row.rolePrompt,
    skillIds: row.skillIds,
    mcpConnectionIds: row.mcpConnectionIds,
    repoAccess: row.repoAccess,
    filesystemGrants: row.filesystemGrants,
    collaborationList: row.collaborationList,
    environmentId: row.environmentId,
    runnerPreference: row.runnerPreference,
    inboxAccess: row.inboxAccess,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
