import { type Database, envBindings, mcpConnections, repos, skills } from "@agentos/db";
import type {
  CreateEnvBindingInput,
  CreateMcpConnectionInput,
  CreateRepoInput,
  CreateSkillInput,
  EnvBindingDto,
  McpConnectionDto,
  RepoDto,
  SkillDto,
} from "@agentos/shared";
import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { DATABASE } from "../db/db.module";
import { ProjectsService } from "../projects/projects.service";
import { SecretsService } from "../secrets/secrets.service";
import { EnvironmentsService } from "./environments.service";

/**
 * The grantable catalog: MCP connections, repos, skills, env bindings.
 *
 * Creating a row here grants nothing. An agent has to list the id before a
 * session sees it (SPEC §5.1).
 */
@Injectable()
export class CatalogService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly projects: ProjectsService,
    private readonly secrets: SecretsService,
    private readonly environments: EnvironmentsService,
  ) {}

  /* ── MCP connections ────────────────────────────────────────────────── */

  async listMcp(projectId: string): Promise<McpConnectionDto[]> {
    await this.projects.require(projectId);
    const rows = await this.db
      .select()
      .from(mcpConnections)
      .where(eq(mcpConnections.projectId, projectId))
      .orderBy(mcpConnections.name);
    return rows.map((row) => ({
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      url: row.url,
      allowedOperations: row.allowedOperations,
      credentialSecretId: row.credentialSecretId,
    }));
  }

  async createMcp(projectId: string, input: CreateMcpConnectionInput): Promise<McpConnectionDto> {
    await this.projects.require(projectId);
    if (input.credentialSecretId) {
      await this.secrets.require(projectId, input.credentialSecretId);
    }
    await this.assertFree(mcpConnections, projectId, input.name, "MCP connection");
    const [row] = await this.db
      .insert(mcpConnections)
      .values({ ...input, projectId })
      .returning();
    return {
      id: row!.id,
      projectId: row!.projectId,
      name: row!.name,
      url: row!.url,
      allowedOperations: row!.allowedOperations,
      credentialSecretId: row!.credentialSecretId,
    };
  }

  async requireMcp(projectId: string, id: string) {
    const row = await this.db.query.mcpConnections.findFirst({
      where: and(eq(mcpConnections.projectId, projectId), eq(mcpConnections.id, id)),
    });
    if (!row) {
      throw new NotFoundException(`MCP connection ${id} not found`);
    }
    return row;
  }

  /* ── Repos ──────────────────────────────────────────────────────────── */

  async listRepos(projectId: string): Promise<RepoDto[]> {
    await this.projects.require(projectId);
    const rows = await this.db
      .select()
      .from(repos)
      .where(eq(repos.projectId, projectId))
      .orderBy(repos.name);
    return rows.map((row) => ({
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      remoteUrl: row.remoteUrl,
      mountPath: row.mountPath,
      credentialSecretId: row.credentialSecretId,
      defaultBranch: row.defaultBranch,
    }));
  }

  async createRepo(projectId: string, input: CreateRepoInput): Promise<RepoDto> {
    await this.projects.require(projectId);
    if (input.credentialSecretId) {
      await this.secrets.require(projectId, input.credentialSecretId);
    }
    await this.assertFree(repos, projectId, input.name, "repo");
    const [row] = await this.db
      .insert(repos)
      .values({ ...input, projectId })
      .returning();
    return {
      id: row!.id,
      projectId: row!.projectId,
      name: row!.name,
      remoteUrl: row!.remoteUrl,
      mountPath: row!.mountPath,
      credentialSecretId: row!.credentialSecretId,
      defaultBranch: row!.defaultBranch,
    };
  }

  /* ── Skills ─────────────────────────────────────────────────────────── */

  async listSkills(projectId: string): Promise<SkillDto[]> {
    await this.projects.require(projectId);
    const rows = await this.db
      .select()
      .from(skills)
      .where(eq(skills.projectId, projectId))
      .orderBy(skills.slug);
    return rows.map((row) => ({
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      slug: row.slug,
      kind: row.kind as SkillDto["kind"],
      body: row.body,
      filePath: row.filePath,
    }));
  }

  async createSkill(projectId: string, input: CreateSkillInput): Promise<SkillDto> {
    await this.projects.require(projectId);
    const clash = await this.db.query.skills.findFirst({
      where: and(eq(skills.projectId, projectId), eq(skills.slug, input.slug)),
    });
    if (clash) {
      throw new ConflictException(`skill "${input.slug}" already exists`);
    }
    const [row] = await this.db
      .insert(skills)
      .values({ ...input, projectId })
      .returning();
    return {
      id: row!.id,
      projectId: row!.projectId,
      name: row!.name,
      slug: row!.slug,
      kind: row!.kind as SkillDto["kind"],
      body: row!.body,
      filePath: row!.filePath,
    };
  }

  /* ── Environment variable bindings ──────────────────────────────────── */

  async listEnvBindings(projectId: string): Promise<EnvBindingDto[]> {
    await this.projects.require(projectId);
    const rows = await this.db
      .select()
      .from(envBindings)
      .where(eq(envBindings.projectId, projectId))
      .orderBy(envBindings.key);
    return rows.map((row) => ({
      id: row.id,
      projectId: row.projectId,
      environmentId: row.environmentId,
      key: row.key,
      secretId: row.secretId,
      allowedHosts: row.allowedHosts,
    }));
  }

  async createEnvBinding(
    projectId: string,
    input: CreateEnvBindingInput,
  ): Promise<EnvBindingDto> {
    await this.projects.require(projectId);
    await this.secrets.require(projectId, input.secretId);
    await this.environments.require(projectId, input.environmentId);
    // A key is unique per environment, not per project: PAYMENT_TOKEN in
    // `staging` and in `production` are different secrets by design.
    const clash = await this.db.query.envBindings.findFirst({
      where: and(
        eq(envBindings.environmentId, input.environmentId),
        eq(envBindings.key, input.key),
      ),
    });
    if (clash) {
      throw new ConflictException(
        `env binding "${input.key}" already exists in that environment`,
      );
    }
    const [row] = await this.db
      .insert(envBindings)
      .values({ ...input, projectId })
      .returning();
    return {
      id: row!.id,
      projectId: row!.projectId,
      environmentId: row!.environmentId,
      key: row!.key,
      secretId: row!.secretId,
      allowedHosts: row!.allowedHosts,
    };
  }

  private async assertFree(
    table: typeof mcpConnections | typeof repos,
    projectId: string,
    name: string,
    label: string,
  ): Promise<void> {
    const [row] = await this.db
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.projectId, projectId), eq(table.name, name)))
      .limit(1);
    if (row) {
      throw new ConflictException(`${label} "${name}" already exists`);
    }
  }
}
