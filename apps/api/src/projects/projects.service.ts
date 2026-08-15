import { type Database, projects } from "@agentos/db";
import type { CreateProjectInput, ProjectDto, UpdateProjectInput } from "@agentos/shared";
import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DATABASE } from "../db/db.module";

type ProjectRow = typeof projects.$inferSelect;

@Injectable()
export class ProjectsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async list(): Promise<ProjectDto[]> {
    const rows = await this.db.select().from(projects).orderBy(projects.createdAt);
    return rows.map(toDto);
  }

  async create(input: CreateProjectInput): Promise<ProjectDto> {
    const existing = await this.db.query.projects.findFirst({
      where: eq(projects.slug, input.slug),
    });
    if (existing) {
      throw new ConflictException(`project slug "${input.slug}" already exists`);
    }
    const [row] = await this.db.insert(projects).values(input).returning();
    return toDto(row!);
  }

  async get(id: string): Promise<ProjectDto> {
    return toDto(await this.require(id));
  }

  async update(id: string, input: UpdateProjectInput): Promise<ProjectDto> {
    await this.require(id);
    const [row] = await this.db
      .update(projects)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(projects.id, id))
      .returning();
    return toDto(row!);
  }

  /** Shared existence check so every route 404s consistently. */
  async require(id: string): Promise<ProjectRow> {
    const row = await this.db.query.projects.findFirst({ where: eq(projects.id, id) });
    if (!row) {
      throw new NotFoundException(`project ${id} not found`);
    }
    return row;
  }
}

function toDto(row: ProjectRow): ProjectDto {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
