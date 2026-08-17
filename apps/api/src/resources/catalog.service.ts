import {
  type Database,
  envBindings,
  githubInstallations,
  mcpConnections,
  repos,
  skills,
} from "@agentos/db";
import { BUILT_IN_MCP, BUILT_IN_SKILLS, normaliseRemote } from "@agentos/shared";
import type {
  CreateEnvBindingInput,
  CreateMcpConnectionInput,
  CreateRepoInput,
  CreateSkillInput,
  EnvBindingDto,
  McpConnectionDto,
  RepoDto,
  SkillDto,
  UpdateMcpConnectionInput,
} from "@agentos/shared";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import { DATABASE } from "../db/db.module";
import { ProjectsService } from "../projects/projects.service";
import { SecretsService } from "../secrets/secrets.service";
import { GithubAppService } from "../github/github-app.service";
import { EnvironmentsService } from "./environments.service";
import { McpVerifier } from "./mcp-verifier";

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
    private readonly verifier: McpVerifier,
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
      verifiedAt: row.verifiedAt?.toISOString() ?? null,
      verifiedTools: row.verifiedTools,
      verifyError: row.verifyError,
    }));
  }

  async createMcp(projectId: string, input: CreateMcpConnectionInput): Promise<McpConnectionDto> {
    await this.projects.require(projectId);
    if (input.credentialSecretId) {
      // The same rule `updateMcp` enforces. Checking it on only one of the two
      // doors is not a check: an operator could attach a `repo` credential at
      // creation and the connection would post a git token to a third-party API
      // on every call.
      await this.requireMcpSecret(projectId, input.credentialSecretId);
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
      verifiedAt: row!.verifiedAt?.toISOString() ?? null,
      verifiedTools: row!.verifiedTools,
      verifyError: row!.verifyError,
    };
  }

  /**
   * Edits a connection in place.
   *
   * The reason this exists: a built-in is installed with no credential, so
   * without an update path the operator's only way to attach one is to delete
   * the connection and hand-type the URL again — losing the narrowed endpoint
   * the catalogue chose for them, which is the whole value of the catalogue.
   *
   * Two invariants hold here.
   *
   * **A secret must belong to this project and be for this purpose.** Without
   * the first check a connection could name another project's secret by id and
   * post its value to whatever URL it liked, which is a cross-project
   * exfiltration primitive built out of two legitimate features. The second is
   * weaker but worth having: a `repo` credential attached to an MCP server is
   * almost always a mistake, and it is a mistake that sends a git token to a
   * third-party API.
   *
   * **Editing grants nothing.** No agent's `mcpConnectionIds` is touched here.
   * A connection an agent already holds keeps working with the new URL, which
   * is the point — but a connection nobody holds stays unreachable.
   */
  async updateMcp(
    projectId: string,
    id: string,
    input: UpdateMcpConnectionInput,
  ): Promise<McpConnectionDto> {
    await this.projects.require(projectId);
    const existing = await this.requireMcp(projectId, id);

    if (input.credentialSecretId) {
      await this.requireMcpSecret(projectId, input.credentialSecretId);
    }

    const [row] = await this.db
      .update(mcpConnections)
      .set({
        url: input.url ?? existing.url,
        allowedOperations: input.allowedOperations ?? existing.allowedOperations,
        // `undefined` means "not sent"; explicit `null` means "detach".
        credentialSecretId:
          input.credentialSecretId === undefined
            ? existing.credentialSecretId
            : input.credentialSecretId,
        // A verification is a statement about a URL and a credential. Change
        // either and the statement no longer refers to anything — leaving the
        // green tick up would be the UI's most confident lie.
        ...(input.url !== undefined || input.credentialSecretId !== undefined
          ? { verifiedAt: null, verifiedTools: [], verifyError: null }
          : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(mcpConnections.projectId, projectId), eq(mcpConnections.id, id)))
      .returning();

    return {
      id: row!.id,
      projectId: row!.projectId,
      name: row!.name,
      url: row!.url,
      allowedOperations: row!.allowedOperations,
      credentialSecretId: row!.credentialSecretId,
      verifiedAt: row!.verifiedAt?.toISOString() ?? null,
      verifiedTools: row!.verifiedTools,
      verifyError: row!.verifyError,
    };
  }

  /**
   * Handshakes with a connection and records what came back.
   *
   * Operator-triggered and nothing else. It resolves the credential — which is
   * the one moment a stored secret's *value* is used outside a session — sends
   * `initialize` and `tools/list`, and writes back names, a timestamp, or an
   * error. It never calls a tool: a catalogued server can charge for one.
   *
   * The result is stored even when it fails, because "checked at 09:14 and the
   * credential was rejected" is the useful state. A failure is not an exception
   * here; an unreachable server is an ordinary answer.
   */
  async verifyMcp(projectId: string, id: string): Promise<McpConnectionDto> {
    await this.projects.require(projectId);
    const row = await this.requireMcp(projectId, id);

    const token = row.credentialSecretId
      ? await this.secrets.resolveValue(row.credentialSecretId)
      : null;
    const result = await this.verifier.verify(row.url, token);

    // Matched on the URL and credential that were actually handshaken, not on
    // the id alone. A second tab that repointed this connection while the
    // request was in flight would otherwise have its new endpoint stamped
    // "verified" on the strength of the old one answering — the single most
    // confident thing this UI could get wrong.
    const [updated] = await this.db
      .update(mcpConnections)
      .set({
        verifiedAt: result.ok ? new Date() : null,
        verifiedTools: result.ok ? result.tools : [],
        verifyError: result.ok ? null : result.error,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(mcpConnections.projectId, projectId),
          eq(mcpConnections.id, id),
          eq(mcpConnections.url, row.url),
          row.credentialSecretId === null
            ? isNull(mcpConnections.credentialSecretId)
            : eq(mcpConnections.credentialSecretId, row.credentialSecretId),
        ),
      )
      .returning();

    if (!updated) {
      // It changed underneath us. Report what is there now rather than a
      // verification of something that is no longer configured.
      const current = await this.requireMcp(projectId, id);
      return {
        id: current.id,
        projectId: current.projectId,
        name: current.name,
        url: current.url,
        allowedOperations: current.allowedOperations,
        credentialSecretId: current.credentialSecretId,
        verifiedAt: current.verifiedAt?.toISOString() ?? null,
        verifiedTools: current.verifiedTools,
        verifyError: current.verifyError,
      };
    }

    return {
      id: updated!.id,
      projectId: updated!.projectId,
      name: updated!.name,
      url: updated!.url,
      allowedOperations: updated!.allowedOperations,
      credentialSecretId: updated!.credentialSecretId,
      verifiedAt: updated!.verifiedAt?.toISOString() ?? null,
      verifiedTools: updated!.verifiedTools,
      verifyError: updated!.verifyError,
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

  /**
   * A secret this project owns, and one meant for MCP use.
   *
   * Project ownership stops a connection naming another project's secret by id
   * and posting its value wherever the URL points — a cross-project
   * exfiltration primitive assembled from two features that each look fine.
   * The purpose check is weaker but catches the common mistake, which sends a
   * git token to a third-party API.
   */
  private async requireMcpSecret(projectId: string, secretId: string): Promise<void> {
    const secret = await this.secrets.require(projectId, secretId);
    if (secret.purpose !== "mcp") {
      throw new BadRequestException(
        `secret "${secret.name}" is for ${secret.purpose} use, not mcp. Attaching it here would ` +
          "send that credential to this server on every call — create an `mcp` secret instead.",
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

  /**
   * Puts the shipped MCP connections into this project.
   *
   * Creating a connection **grants nothing**: the row is inert until an agent
   * lists it, and a `limited` environment still has to allow its host. So this
   * is safe to run on a fresh project — what it buys is that the operator picks
   * from endpoints someone already checked against the vendor's documentation.
   *
   * Only the entries marked `installByDefault` are created. The billable and
   * mutating ones — full-access GitHub, Apify Actor execution, Stripe — stay in
   * the catalogue and out of the project until the operator installs them
   * deliberately.
   *
   * Idempotent by name, and an existing name is left exactly as it is rather
   * than refreshed. The reasoning is the same as for skills: the thing that
   * would be overwritten is an operator's own connection, and "our built-in
   * names probably do not collide" is not a safety boundary.
   *
   * **No credential is attached.** Every entry that needs one names an
   * environment variable in `credentialEnvVar`; the operator creates the secret
   * reference and binds it. Minting secret references here would produce rows
   * that resolve to nothing and a manifest that quietly drops the grant.
   */
  async installBuiltInMcp(projectId: string): Promise<McpConnectionDto[]> {
    await this.projects.require(projectId);
    const installed: McpConnectionDto[] = [];
    for (const seed of BUILT_IN_MCP) {
      const [row] = await this.db
        .insert(mcpConnections)
        .values({
          projectId,
          name: seed.slug,
          url: seed.url,
          allowedOperations: seed.allowedOperations,
          credentialSecretId: null,
        })
        .onConflictDoNothing({ target: [mcpConnections.projectId, mcpConnections.name] })
        .returning();
      const present =
        row ??
        (await this.db.query.mcpConnections.findFirst({
          where: and(eq(mcpConnections.projectId, projectId), eq(mcpConnections.name, seed.slug)),
        }));
      if (present) {
        installed.push({
          id: present.id,
          projectId: present.projectId,
          name: present.name,
          url: present.url,
          allowedOperations: present.allowedOperations,
          credentialSecretId: present.credentialSecretId,
          verifiedAt: present.verifiedAt?.toISOString() ?? null,
          verifiedTools: present.verifiedTools,
          verifyError: present.verifyError,
        });
      }
    }
    return installed;
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
      description: row.description,
      category: row.category as SkillDto["category"],
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
      description: row!.description,
      category: row!.category as SkillDto["category"],
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
   * **The skill's text is never overwritten.** The first version replaced an
   * existing slug wholesale, on the reasoning that the built-in names were
   * unlikely to collide — but "unlikely to collide" is not a safety boundary,
   * and the thing being replaced would have been an operator's own skill body.
   * Editing a built-in and re-running the installer keeps your edit; delete the
   * skill first if you want the shipped one back.
   *
   * What it *does* refresh, and only on rows it created (`built_in`), is
   * `description` and `category`. Those are metadata we author so the Skills
   * page can be navigated, not instructions the agent follows, and leaving them
   * stale is what left three shipped skills sitting in `general` with no
   * description after the columns were added. A skill the operator wrote is
   * untouched on every field, exactly as before.
   */
  async installBuiltInSkills(projectId: string): Promise<SkillDto[]> {
    await this.projects.require(projectId);
    const installed: SkillDto[] = [];
    for (const skill of BUILT_IN_SKILLS) {
      const [row] = await this.db
        .insert(skills)
        .values({ ...skill, projectId, filePath: null, builtIn: true })
        .onConflictDoUpdate({
          target: [skills.projectId, skills.slug],
          set: {
            description: skill.description,
            category: skill.category,
            updatedAt: new Date(),
          },
          setWhere: eq(skills.builtIn, true),
        })
        .returning();
      // `returning()` is empty when the `setWhere` refused the update — an
      // operator's own skill of the same name. Report what is actually there
      // rather than a short list.
      const present =
        row ??
        (await this.db.query.skills.findFirst({
          where: and(eq(skills.projectId, projectId), eq(skills.slug, skill.slug)),
        }));
      if (present) {
        installed.push({
          id: present.id,
          projectId: present.projectId,
          name: present.name,
          slug: present.slug,
          description: present.description,
          category: present.category as SkillDto["category"],
          kind: present.kind as SkillDto["kind"],
          body: present.body,
          filePath: present.filePath,
        });
      }
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
