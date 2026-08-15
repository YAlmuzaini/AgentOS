import {
  agents,
  type Database,
  environments,
  mcpConnections,
  repos,
  secretRefs,
  skills,
  taskTemplates,
} from "@agentos/db";
import { type AgentosDocument, FOUNDATIONAL_PROMPT } from "@agentos/shared";
import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { DATABASE } from "../db/db.module";

/**
 * Applies an `agentos.yml` document to a project.
 *
 * Upserts run in dependency order — secrets, environments, then the things
 * that reference them, then agents last because agents reference everything.
 * Every write is keyed by name, which is what makes `push` idempotent.
 */
@Injectable()
export class DocumentWriter {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async upsertSecrets(
    projectId: string,
    document: AgentosDocument,
  ): Promise<Map<string, string>> {
    const ids = new Map<string, string>();
    for (const [name, secret] of Object.entries(document.secrets)) {
      const [row] = await this.db
        .insert(secretRefs)
        .values({ projectId, name, providerRef: secret.providerRef, purpose: secret.purpose })
        .onConflictDoUpdate({
          target: [secretRefs.projectId, secretRefs.name],
          set: { providerRef: secret.providerRef, purpose: secret.purpose },
        })
        .returning();
      ids.set(name, row!.id);
    }
    return ids;
  }

  async upsertEnvironments(
    projectId: string,
    document: AgentosDocument,
  ): Promise<Map<string, string>> {
    const ids = new Map<string, string>();
    for (const [name, environment] of Object.entries(document.environments)) {
      const [row] = await this.db
        .insert(environments)
        .values({
          projectId,
          name,
          networking: environment.networking,
          allowedHosts: environment.allowedHosts,
        })
        .onConflictDoUpdate({
          target: [environments.projectId, environments.name],
          set: {
            networking: environment.networking,
            allowedHosts: environment.allowedHosts,
            runtimeEnvironmentId: null,
            updatedAt: new Date(),
          },
        })
        .returning();
      ids.set(name, row!.id);
    }
    return ids;
  }

  async upsertMcp(
    projectId: string,
    document: AgentosDocument,
    secretIds: Map<string, string>,
  ): Promise<Map<string, string>> {
    const ids = new Map<string, string>();
    for (const [name, connection] of Object.entries(document.mcp)) {
      const [row] = await this.db
        .insert(mcpConnections)
        .values({
          projectId,
          name,
          url: connection.url,
          allowedOperations: connection.allowedOperations,
          credentialSecretId: connection.credential ? (secretIds.get(connection.credential) ?? null) : null,
        })
        .onConflictDoUpdate({
          target: [mcpConnections.projectId, mcpConnections.name],
          set: {
            url: connection.url,
            allowedOperations: connection.allowedOperations,
            credentialSecretId: connection.credential
              ? (secretIds.get(connection.credential) ?? null)
              : null,
            updatedAt: new Date(),
          },
        })
        .returning();
      ids.set(name, row!.id);
    }
    return ids;
  }

  async upsertRepos(
    projectId: string,
    document: AgentosDocument,
    secretIds: Map<string, string>,
  ): Promise<Map<string, string>> {
    const ids = new Map<string, string>();
    for (const [name, repo] of Object.entries(document.repos)) {
      const credentialSecretId = repo.credential ? (secretIds.get(repo.credential) ?? null) : null;
      const [row] = await this.db
        .insert(repos)
        .values({
          projectId,
          name,
          remoteUrl: repo.remoteUrl,
          mountPath: repo.mountPath,
          defaultBranch: repo.defaultBranch,
          credentialSecretId,
        })
        .onConflictDoUpdate({
          target: [repos.projectId, repos.name],
          set: {
            remoteUrl: repo.remoteUrl,
            mountPath: repo.mountPath,
            defaultBranch: repo.defaultBranch,
            credentialSecretId,
            updatedAt: new Date(),
          },
        })
        .returning();
      ids.set(name, row!.id);
    }
    return ids;
  }

  async upsertSkills(
    projectId: string,
    document: AgentosDocument,
  ): Promise<Map<string, string>> {
    const ids = new Map<string, string>();
    for (const [slug, skill] of Object.entries(document.skills)) {
      const [row] = await this.db
        .insert(skills)
        .values({
          projectId,
          slug,
          name: skill.name,
          kind: skill.kind,
          body: skill.body,
          filePath: skill.filePath,
        })
        .onConflictDoUpdate({
          target: [skills.projectId, skills.slug],
          set: {
            name: skill.name,
            kind: skill.kind,
            body: skill.body,
            filePath: skill.filePath,
            updatedAt: new Date(),
          },
        })
        .returning();
      ids.set(slug, row!.id);
    }
    return ids;
  }

  async upsertTemplates(
    projectId: string,
    document: AgentosDocument,
  ): Promise<void> {
    for (const [name, template] of Object.entries(document.templates)) {
      await this.db
        .insert(taskTemplates)
        .values({
          projectId,
          name,
          description: template.description,
          variables: template.variables,
          steps: template.steps,
        })
        .onConflictDoUpdate({
          target: [taskTemplates.projectId, taskTemplates.name],
          set: {
            description: template.description,
            variables: template.variables,
            steps: template.steps,
            updatedAt: new Date(),
          },
        });
    }
  }

  async upsertAgents(
    projectId: string,
    document: AgentosDocument,
    context: {
      environmentIds: Map<string, string>;
      mcpIds: Map<string, string>;
      repoIds: Map<string, string>;
      skillIds: Map<string, string>;
    },
  ): Promise<void> {
    for (const [name, agent] of Object.entries(document.agents)) {
      const missing = [
        ...agent.mcp.filter((entry) => !context.mcpIds.has(entry)).map((entry) => `mcp:${entry}`),
        ...agent.skills
          .filter((entry) => !context.skillIds.has(entry))
          .map((entry) => `skill:${entry}`),
        ...agent.repos
          .filter((entry) => !context.repoIds.has(entry.name))
          .map((entry) => `repo:${entry.name}`),
      ];
      if (missing.length > 0) {
        // A dangling grant would silently become "no access", so refuse the
        // whole agent rather than quietly narrowing it.
        throw new BadRequestException(
          `agent "${name}" references things this document does not define: ${missing.join(", ")}`,
        );
      }

      const values = {
        projectId,
        name,
        title: agent.title,
        model: agent.model,
        foundationalPrompt: FOUNDATIONAL_PROMPT,
        rolePrompt: agent.prompt,
        skillIds: agent.skills.map((entry) => context.skillIds.get(entry)!),
        mcpConnectionIds: agent.mcp.map((entry) => context.mcpIds.get(entry)!),
        repoAccess: agent.repos.map((entry) => ({
          repoId: context.repoIds.get(entry.name)!,
          mountPath: entry.mount,
          permissions: entry.permissions,
        })),
        filesystemGrants: agent.filesystem,
        collaborationList: agent.collaboration,
        environmentId: agent.environment ? (context.environmentIds.get(agent.environment) ?? null) : null,
        runnerPreference: agent.runner,
        inboxAccess: agent.inbox,
      };

      await this.db
        .insert(agents)
        .values(values)
        .onConflictDoUpdate({
          target: [agents.projectId, agents.name],
          set: { ...values, runtimeConfigHash: null, updatedAt: new Date() },
        });
    }
  }
}
