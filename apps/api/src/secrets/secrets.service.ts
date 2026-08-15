import { type Database, secretRefs } from "@agentos/db";
import type { CreateSecretRefInput, SecretPurpose, SecretRefDto } from "@agentos/shared";
import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { DATABASE } from "../db/db.module";
import { ProjectsService } from "../projects/projects.service";
import { SECRETS_PROVIDER, type SecretsProvider } from "./secrets.provider";

export type SecretRefRow = typeof secretRefs.$inferSelect;

@Injectable()
export class SecretsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(SECRETS_PROVIDER) private readonly provider: SecretsProvider,
    private readonly projects: ProjectsService,
  ) {}

  async list(projectId: string): Promise<SecretRefDto[]> {
    await this.projects.require(projectId);
    const rows = await this.db
      .select()
      .from(secretRefs)
      .where(eq(secretRefs.projectId, projectId))
      .orderBy(secretRefs.name);
    return Promise.all(rows.map((row) => this.toDto(row)));
  }

  async create(projectId: string, input: CreateSecretRefInput): Promise<SecretRefDto> {
    await this.projects.require(projectId);
    const clash = await this.db.query.secretRefs.findFirst({
      where: and(eq(secretRefs.projectId, projectId), eq(secretRefs.name, input.name)),
    });
    if (clash) {
      throw new ConflictException(`secret "${input.name}" already exists`);
    }
    const [row] = await this.db
      .insert(secretRefs)
      .values({ ...input, projectId })
      .returning();
    return this.toDto(row!);
  }

  async remove(projectId: string, id: string): Promise<void> {
    await this.require(projectId, id);
    await this.db.delete(secretRefs).where(eq(secretRefs.id, id));
  }

  /**
   * Resolves a reference to its value. The only caller is the session
   * provisioner; the value goes straight into the runtime and is never
   * returned over the API.
   */
  async resolveValue(id: string): Promise<string | null> {
    const row = await this.db.query.secretRefs.findFirst({ where: eq(secretRefs.id, id) });
    if (!row) {
      return null;
    }
    return this.provider.resolve(row.providerRef);
  }

  async require(projectId: string, id: string): Promise<SecretRefRow> {
    const row = await this.db.query.secretRefs.findFirst({
      where: and(eq(secretRefs.projectId, projectId), eq(secretRefs.id, id)),
    });
    if (!row) {
      throw new NotFoundException(`secret ${id} not found`);
    }
    return row;
  }

  private async toDto(row: SecretRefRow): Promise<SecretRefDto> {
    return {
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      providerRef: row.providerRef,
      purpose: row.purpose as SecretPurpose,
      resolvable: (await this.provider.resolve(row.providerRef)) !== null,
    };
  }
}
