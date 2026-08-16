import { type Database, githubInstallations, repos as reposTable } from "@agentos/db";
import type { GithubInstallationDto, GithubStatusDto, RemoteRepoDto } from "@agentos/shared";
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { APP_CONFIG, type AppConfig } from "../config/config";
import { DATABASE } from "../db/db.module";
import { ProjectsService } from "../projects/projects.service";
import { GithubAppService } from "./github-app.service";
import { InstallStateStore } from "./install-state";

type InstallationRow = typeof githubInstallations.$inferSelect;

/**
 * Connecting a project to GitHub without a personal access token (SPEC §4).
 *
 * The operator presses Connect, approves the App on github.com against the
 * repositories they choose, and comes back. Nothing secret crosses the wire:
 * what is stored is an installation id, and it is inert without the App's
 * private key.
 */
@Injectable()
export class GithubService {
  private readonly states = new InstallStateStore();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly app: GithubAppService,
    private readonly projects: ProjectsService,
  ) {}

  async status(projectId: string): Promise<GithubStatusDto> {
    await this.projects.require(projectId);
    return {
      configured: this.app.configured(),
      appSlug: this.app.slug,
      installations: (await this.listRows(projectId)).map(toDto),
    };
  }

  /**
   * Where to send the operator's browser.
   *
   * `installations/new` is GitHub's own repository picker — this is the step
   * that replaces "paste a token": the operator chooses, on github.com, which
   * repositories AgentOS may ever see.
   */
  async installUrl(projectId: string): Promise<{ url: string }> {
    await this.projects.require(projectId);
    if (!this.app.configured()) {
      throw new BadRequestException(
        "no GitHub App is configured on this installation: set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY",
      );
    }
    if (!this.app.slug) {
      throw new BadRequestException(
        "GITHUB_APP_SLUG is not set, so the installation URL cannot be built",
      );
    }
    const state = this.states.issue({ projectId });
    const url = new URL(`${this.app.htmlUrl}/apps/${encodeURIComponent(this.app.slug)}/installations/new`);
    url.searchParams.set("state", state);
    return { url: url.toString() };
  }

  /**
   * GitHub's redirect back, after the operator approved the App.
   *
   * Two things are checked before anything is written, and both matter: the
   * `state` proves this callback belongs to a Connect the operator started, and
   * asking GitHub about the installation proves the id in the query string is
   * really an installation of *this* App rather than a number someone typed.
   */
  async completeInstall(input: {
    installationId: string;
    state: string | undefined;
    setupAction: string | undefined;
  }): Promise<{ redirectTo: string }> {
    const web = this.config.WEB_ORIGIN.replace(/\/+$/, "");

    // `update` is GitHub sending the operator back after they changed which
    // repositories an existing installation covers. There is nothing to bind.
    if (input.setupAction === "update") {
      return { redirectTo: `${web}/repos` };
    }

    const state = this.states.consume(input.state);
    if (!state) {
      throw new BadRequestException(
        "this GitHub callback did not match a connection started here, or it expired",
      );
    }

    const summary = await this.app.describeInstallation(input.installationId);
    if (!summary) {
      throw new BadRequestException(
        "GitHub could not confirm that installation belongs to this App",
      );
    }

    await this.db
      .insert(githubInstallations)
      .values({
        projectId: state.projectId,
        installationId: summary.installationId,
        accountLogin: summary.accountLogin,
        accountType: summary.accountType,
        repositorySelection: summary.repositorySelection,
      })
      .onConflictDoUpdate({
        target: [githubInstallations.projectId, githubInstallations.installationId],
        set: {
          accountLogin: summary.accountLogin,
          accountType: summary.accountType,
          repositorySelection: summary.repositorySelection,
          updatedAt: new Date(),
        },
      });

    return { redirectTo: `${web}/repos?connected=${encodeURIComponent(summary.accountLogin)}` };
  }

  /** The repositories this installation may reach, for the picker. */
  async listRepositories(projectId: string, id: string): Promise<RemoteRepoDto[]> {
    const row = await this.require(projectId, id);
    return this.app.listRepositories(row.installationId);
  }

  async remove(projectId: string, id: string): Promise<void> {
    const row = await this.require(projectId, id);
    // Repos pointing at it fall back to their secret credential, or to none —
    // `set null` on the FK, so a disconnect never deletes a repo.
    await this.db.delete(githubInstallations).where(eq(githubInstallations.id, row.id));
    this.app.forget(row.installationId);
  }

  /** Resolves the clone credential for a repo, or null when it has no installation. */
  async cloneToken(repo: typeof reposTable.$inferSelect): Promise<string | null> {
    if (!repo.githubInstallationId) {
      return null;
    }
    const row = await this.db.query.githubInstallations.findFirst({
      // Scoped by project as well as id: a repo may not borrow another
      // project's installation even if a stale id points at one.
      where: and(
        eq(githubInstallations.id, repo.githubInstallationId),
        eq(githubInstallations.projectId, repo.projectId),
      ),
    });
    if (!row) {
      return null;
    }
    return this.app.installationToken(row.installationId);
  }

  private async listRows(projectId: string): Promise<InstallationRow[]> {
    return this.db
      .select()
      .from(githubInstallations)
      .where(eq(githubInstallations.projectId, projectId))
      .orderBy(githubInstallations.createdAt);
  }

  private async require(projectId: string, id: string): Promise<InstallationRow> {
    const row = await this.db.query.githubInstallations.findFirst({
      where: and(eq(githubInstallations.id, id), eq(githubInstallations.projectId, projectId)),
    });
    if (!row) {
      throw new NotFoundException(`github installation ${id} not found`);
    }
    return row;
  }
}

function toDto(row: InstallationRow): GithubInstallationDto {
  return {
    id: row.id,
    projectId: row.projectId,
    installationId: row.installationId,
    accountLogin: row.accountLogin,
    accountType: row.accountType,
    repositorySelection: row.repositorySelection,
    createdAt: row.createdAt.toISOString(),
  };
}
