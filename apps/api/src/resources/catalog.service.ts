import {
  type Database,
  envBindings,
  githubInstallations,
  mcpConnections,
  repos,
  skills,
} from "@agentos/db";
import { BUILT_IN_SKILLS, normaliseRemote } from "@agentos/shared";
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
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { DATABASE } from "../db/db.module";
import { ProjectsService } from "../projects/projects.service";
import { SecretsService } from "../secrets/secrets.service";
import { GithubAppService } from "../github/github-app.service";
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
    private readonly github: GithubAppService,
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

  /**
   * Refuses a remote the installation does not actually cover.
   *
   * Without this an operator can pair a legitimate installation with any URL
   * they like, and the next session posts a live installation token — good for
   * every repository that installation covers — to whatever host it names. The
   * clone path refuses a foreign host on its own, but that produces a failed
   * session at 3am; this produces a sentence at the moment the repo is added.
   */
  private async assertRemoteIsInstalled(installationId: string, remoteUrl: string): Promise<void> {
    const wanted = normaliseRemote(remoteUrl);
    if (!wanted) {
      throw new BadRequestException(`${remoteUrl} is not a git remote this can parse`);
    }
    const available = await this.github.listRepositories(installationId);
    if (!available.some((repo) => normaliseRemote(repo.cloneUrl) === wanted)) {
      throw new BadRequestException(
        `that GitHub connection does not cover ${wanted}. Pick one of the repositories it granted, ` +
          "or add it to the App's installation on GitHub first. Note the remote must be the https " +
          "one GitHub reports — an installation token is HTTP Basic auth, so an ssh or http remote " +
          "is a different thing that cannot carry it.",
      );
    }
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
      githubInstallationId: row.githubInstallationId,
      credentialSecretId: row.credentialSecretId,
      defaultBranch: row.defaultBranch,
    }));
  }

  async createRepo(projectId: string, input: CreateRepoInput): Promise<RepoDto> {
    await this.projects.require(projectId);
    if (input.credentialSecretId) {
      await this.secrets.require(projectId, input.credentialSecretId);
    }
    if (input.githubInstallationId) {
      // Same rule as a secret: the installation has to belong to this project,
      // or a repo could name another project's connection and clone through it.
      const installation = await this.db.query.githubInstallations.findFirst({
        where: and(
          eq(githubInstallations.id, input.githubInstallationId),
          eq(githubInstallations.projectId, projectId),
        ),
      });
      if (!installation) {
        throw new NotFoundException(
          `github installation ${input.githubInstallationId} not found in this project`,
        );
      }
      await this.assertRemoteIsInstalled(installation.installationId, input.remoteUrl);
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
      githubInstallationId: row!.githubInstallationId,
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

  /**
   * Puts the shipped skills into this project (SPEC §4 Skill).
   *
   * Idempotent by slug, which is also the answer to "will this duplicate what I
   * already have": a skill is unique per project, so a second run adds nothing.
   *
   * An existing slug is **left exactly as it is**, rather than refreshed. The
   * first version overwrote it, on the reasoning that the built-in names were
   * unlikely to collide — but "unlikely to collide" is not a safety boundary,
   * and the thing being overwritten would have been an operator's own skill
   * text. Editing a built-in and re-running the installer keeps your edit;
   * delete the skill first if you want the shipped one back.
   */
  async installBuiltInSkills(projectId: string): Promise<SkillDto[]> {
    await this.projects.require(projectId);
    const installed: SkillDto[] = [];
    for (const skill of BUILT_IN_SKILLS) {
      const [row] = await this.db
        .insert(skills)
        .values({ ...skill, projectId, filePath: null })
        .onConflictDoNothing({ target: [skills.projectId, skills.slug] })
        .returning();
      if (!row) {
        // Already present and left alone; report what is there rather than
        // silently returning a short list.
        const existing = await this.db.query.skills.findFirst({
          where: and(eq(skills.projectId, projectId), eq(skills.slug, skill.slug)),
        });
        if (existing) {
          installed.push({
            id: existing.id,
            projectId: existing.projectId,
            name: existing.name,
            slug: existing.slug,
            kind: existing.kind as SkillDto["kind"],
            body: existing.body,
            filePath: existing.filePath,
          });
        }
        continue;
      }
      installed.push({
        id: row.id,
        projectId: row.projectId,
        name: row.name,
        slug: row.slug,
        kind: row.kind as SkillDto["kind"],
        body: row.body,
        filePath: row.filePath,
      });
    }
    return installed;
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
