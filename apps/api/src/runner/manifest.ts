import {
  type Database,
  envBindings,
  mcpConnections,
  repos as reposTable,
  skills as skillsTable,
} from "@agentos/db";
import { remoteAcceptsInstallationToken } from "@agentos/shared";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";
import type { AgentRow } from "../agents/agents.service";
import { DATABASE } from "../db/db.module";
import { GithubAppService } from "../github/github-app.service";
import { GithubService } from "../github/github.service";
import { registerSecret } from "../observability/secret-registry";
import { SecretsService } from "../secrets/secrets.service";
import type {
  GrantedEnvVar,
  GrantedMcpServer,
  GrantedRepo,
  GrantedSkill,
} from "./runner.types";

export interface ResolvedGrants {
  mcpServers: GrantedMcpServer[];
  repos: GrantedRepo[];
  envVars: GrantedEnvVar[];
  skills: GrantedSkill[];
}

/**
 * Turns an agent's grant lists into the concrete manifest a session gets.
 *
 * This is the enforcement point for SPEC §5.1: the resolver reads only the ids
 * the agent lists, so a connection that exists on the project but is not
 * granted is invisible to the session — there is no code path that would
 * attach it. Secrets are resolved here and handed straight to the runner.
 */
@Injectable()
export class ManifestResolver {
  private readonly logger = new Logger(ManifestResolver.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly secrets: SecretsService,
    private readonly github: GithubService,
    private readonly githubApp: GithubAppService,
  ) {}

  async resolve(agent: AgentRow): Promise<ResolvedGrants> {
    const [mcpServers, repos, skills, envVars] = await Promise.all([
      this.resolveMcp(agent),
      this.resolveRepos(agent),
      this.resolveSkills(agent),
      // Environment variables follow the agent's environment, not the project:
      // an agent with no environment gets none.
      this.resolveEnvVars(agent),
    ]);
    return { mcpServers, repos, skills, envVars };
  }

  private async resolveMcp(agent: AgentRow): Promise<GrantedMcpServer[]> {
    if (agent.mcpConnectionIds.length === 0) {
      return [];
    }
    const rows = await this.db
      .select()
      .from(mcpConnections)
      .where(
        and(
          eq(mcpConnections.projectId, agent.projectId),
          inArray(mcpConnections.id, agent.mcpConnectionIds),
        ),
      );

    return Promise.all(
      rows.map(async (row) => ({
        name: row.name,
        url: row.url,
        allowedOperations: row.allowedOperations,
        token: row.credentialSecretId
          ? await this.resolveSecret(row.credentialSecretId, `MCP ${row.name}`)
          : null,
      })),
    );
  }

  private async resolveRepos(agent: AgentRow): Promise<GrantedRepo[]> {
    if (agent.repoAccess.length === 0) {
      return [];
    }
    const ids = agent.repoAccess.map((access) => access.repoId);
    const rows = await this.db
      .select()
      .from(reposTable)
      .where(and(eq(reposTable.projectId, agent.projectId), inArray(reposTable.id, ids)));

    const granted: GrantedRepo[] = [];
    for (const access of agent.repoAccess) {
      const row = rows.find((candidate) => candidate.id === access.repoId);
      if (!row) {
        continue;
      }
      granted.push({
        name: row.name,
        remoteUrl: row.remoteUrl,
        // The agent's mount path wins: the same repo can be mounted differently
        // for different roles.
        mountPath: access.mountPath || row.mountPath,
        branch: row.defaultBranch,
        permissions: access.permissions,
        token: await this.repoToken(row),
      });
    }
    return granted;
  }

  /**
   * The credential this clone will use.
   *
   * A GitHub App installation beats a stored personal access token whenever
   * both are set, and the difference is the point of having it: the installation
   * mints a token that expires in an hour and reaches only the repositories the
   * operator selected on github.com, where a PAT is long-lived and carries the
   * union of every scope its owner ticked. A session that leaks one leaks very
   * different amounts.
   *
   * Two rules make that safe, and both are here rather than at the form that
   * usually creates a repo, because this is the one place every clone passes
   * through — `agentos push` is a second door that can rewrite `remoteUrl` on a
   * row whose installation stays put.
   *
   * **The whole origin must be the App's own, over https.** Otherwise a repo
   * pointing at `https://attacker.example/x.git` with a legitimate installation
   * attached makes the next session post a live token to that host, and that
   * token opens every repository the installation covers. Scheme and port are
   * part of that check rather than the host alone: `http://github.com/x` was
   * accepted by a host-only comparison, and git then sent the token in
   * plaintext to whatever answered on port 80.
   *
   * **A repo bound to an installation never silently falls back to the PAT.**
   * A transient GitHub outage would otherwise swap a narrow, hour-long
   * credential for a long-lived account-wide one at exactly the moment nobody
   * is watching. The clone fails instead, which is the smaller loss and the one
   * that shows up in the session record.
   */
  private async repoToken(row: typeof reposTable.$inferSelect): Promise<string | null> {
    if (row.githubInstallationId) {
      if (!remoteAcceptsInstallationToken(row.remoteUrl, this.githubApp.htmlUrl)) {
        this.logger.error(
          `repo ${row.name}: ${row.remoteUrl} is not an https remote on ${this.githubApp.htmlUrl}, so no installation token was minted`,
        );
        return null;
      }
      try {
        const token = await this.github.cloneToken(row);
        if (token) {
          registerSecret(token);
          return token;
        }
        this.logger.warn(`repo ${row.name}: its GitHub installation no longer exists`);
      } catch (error) {
        this.logger.warn(`repo ${row.name}: could not mint an installation token: ${String(error)}`);
      }
      return null;
    }
    return row.credentialSecretId
      ? this.resolveSecret(row.credentialSecretId, `repo ${row.name}`)
      : null;
  }

  private async resolveSkills(agent: AgentRow): Promise<GrantedSkill[]> {
    if (agent.skillIds.length === 0) {
      return [];
    }
    const rows = await this.db
      .select()
      .from(skillsTable)
      .where(
        and(eq(skillsTable.projectId, agent.projectId), inArray(skillsTable.id, agent.skillIds)),
      );
    // `kind` and `filePath` travel with the skill: a file skill has no body,
    // and dropping them handed the session an empty skill with no way to find
    // its content.
    return rows.map((row) => ({
      slug: row.slug,
      name: row.name,
      kind: row.kind as "prompt" | "file",
      body: row.body,
      filePath: row.filePath,
    }));
  }

  /**
   * Environment variables are granted per environment rather than per agent:
   * the environment is what defines where a session may reach, and a value
   * that can only be substituted into an unreachable host is inert anyway.
   *
   * The `environmentId` filter is the whole point. Without it this query
   * returned every binding in the project, so an agent placed in the most
   * restricted environment still received production credentials — the exact
   * thing SPEC §5.6 forbids.
   */
  private async resolveEnvVars(agent: AgentRow): Promise<GrantedEnvVar[]> {
    if (!agent.environmentId) {
      return [];
    }
    const rows = await this.db
      .select()
      .from(envBindings)
      .where(
        and(
          eq(envBindings.projectId, agent.projectId),
          eq(envBindings.environmentId, agent.environmentId),
        ),
      );

    const granted: GrantedEnvVar[] = [];
    for (const row of rows) {
      const value = await this.resolveSecret(row.secretId, `env ${row.key}`);
      if (value !== null) {
        granted.push({ key: row.key, value, allowedHosts: row.allowedHosts });
      }
    }
    return granted;
  }

  private async resolveSecret(secretId: string, label: string): Promise<string | null> {
    const value = await this.secrets.resolveValue(secretId);
    // Registered the moment it exists, so anything that later quotes this value
    // in an error cannot ship it off the machine. Shape-matching alone missed
    // every credential whose format nobody had listed.
    registerSecret(value);
    if (value === null) {
      // A missing secret degrades the grant rather than the run: the session
      // starts without it and the agent finds out when the call fails.
      this.logger.warn(`secret for ${label} did not resolve; the grant is dropped`);
    }
    return value;
  }
}
