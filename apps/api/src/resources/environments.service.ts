import { type Database, environments } from "@agentos/db";
import type {
  CreateEnvironmentInput,
  EnvironmentDto,
  UpdateEnvironmentInput,
} from "@agentos/shared";
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { DATABASE } from "../db/db.module";
import { ProjectsService } from "../projects/projects.service";

export type EnvironmentRow = typeof environments.$inferSelect;

/** The network wall. `limited` is deny-by-default; hosts are opted in. */
@Injectable()
export class EnvironmentsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly projects: ProjectsService,
  ) {}

  async list(projectId: string): Promise<EnvironmentDto[]> {
    await this.projects.require(projectId);
    const rows = await this.db
      .select()
      .from(environments)
      .where(eq(environments.projectId, projectId))
      .orderBy(environments.name);
    return rows.map(toDto);
  }

  async create(projectId: string, input: CreateEnvironmentInput): Promise<EnvironmentDto> {
    await this.projects.require(projectId);
    this.assertCoherent(input.networking, input.allowedHosts);
    const clash = await this.db.query.environments.findFirst({
      where: and(eq(environments.projectId, projectId), eq(environments.name, input.name)),
    });
    if (clash) {
      throw new ConflictException(`environment "${input.name}" already exists`);
    }
    const [row] = await this.db
      .insert(environments)
      .values({ ...input, projectId })
      .returning();
    return toDto(row!);
  }

  async update(
    projectId: string,
    id: string,
    input: UpdateEnvironmentInput,
  ): Promise<EnvironmentDto> {
    const current = await this.require(projectId, id);
    this.assertCoherent(
      input.networking ?? current.networking,
      input.allowedHosts ?? current.allowedHosts,
    );
    const [row] = await this.db
      .update(environments)
      .set({
        ...input,
        // The runtime environment is immutable once created, so a policy change
        // must publish a new one rather than silently widening a live sandbox.
        runtimeEnvironmentId: null,
        updatedAt: new Date(),
      })
      .where(eq(environments.id, id))
      .returning();
    return toDto(row!);
  }

  async require(projectId: string, id: string): Promise<EnvironmentRow> {
    const row = await this.db.query.environments.findFirst({
      where: and(eq(environments.projectId, projectId), eq(environments.id, id)),
    });
    if (!row) {
      throw new NotFoundException(`environment ${id} not found`);
    }
    return row;
  }

  private assertCoherent(networking: string, allowedHosts: string[]): void {
    if (networking === "open" && allowedHosts.length > 0) {
      throw new BadRequestException(
        "an open environment has unrestricted egress; allowedHosts would be misleading",
      );
    }
  }
}

export function toDto(row: EnvironmentRow): EnvironmentDto {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    networking: row.networking,
    allowedHosts: row.allowedHosts,
  };
}
