import {
  agents,
  type Database,
  environments,
  mcpConnections,
  repos,
  secretRefs,
  skills,
  taskTemplates,
  blueprintInstallations,
  projectResourceSlots,
  packInstallations,
} from "@agentos/db";
import { type AgentosDocument, FOUNDATIONAL_PROMPT } from "@agentos/shared";
import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DATABASE } from "../db/db.module";

/**
 * Applies an `agentos.yml` document to a project.
 *
 * Upserts run in dependency order — secrets, environments, then the things
 * that reference them, then agents last because agents reference everything.
 * Every write is keyed by name, which is what makes `push` idempotent.
 */
/**
 * Refuses a name the document references but never defines.
 *
 * Resolving it to `null` looked forgiving and was not: a mistyped credential
 * produced a resource with no credential, and a mistyped environment moved an
 * agent into "no environment", which is the most restricted setting there is —
 * both silent, both only discovered when a session failed for an unrelated
 * reason.
 */
function requireDefined(
  known: Map<string, string>,
  reference: string | null | undefined,
  what: string,
): void {
  if (reference && !known.has(reference)) {
    throw new BadRequestException(`${what} refers to "${reference}", which this document does not define`);
  }
}

export interface McpEndpoint {
  name: string;
  url: string;
  credentialSecretId: string | null;
  providerRef: string | null;
}

/** Same server, same credential — so an existing verification still refers to it. */
function sameEndpoint(
  previous: { url: string; credentialSecretId: string | null; providerRef: string | null },
  url: string,
  credentialSecretId: string | null,
  providerRef: string | null,
): boolean {
  return (
    previous.url === url &&
    previous.credentialSecretId === credentialSecretId &&
    // A null previous providerRef means there was no credential attached; the
    // id comparison above already covers that transition.
    (previous.providerRef === null || previous.providerRef === providerRef)
  );
}

@Injectable()
export class DocumentWriter {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async upsertCompany(
    projectId: string,
    document: AgentosDocument,
    resources: { repoIds: Map<string, string>; mcpIds: Map<string, string>; environmentIds: Map<string, string> },
  ): Promise<void> {
    for (const [slug, profile] of Object.entries(document.companyProfiles)) {
      await this.db.insert(blueprintInstallations).values({
        projectId, blueprintSlug: slug, version: profile.version, provenance: profile.provenance,
      }).onConflictDoUpdate({
        target: [blueprintInstallations.projectId, blueprintInstallations.blueprintSlug],
        set: { version: profile.version, provenance: profile.provenance, updatedAt: new Date() },
      });
    }
    for (const [slug, pack] of Object.entries(document.agentPacks)) {
      await this.db.insert(packInstallations).values({
        projectId, packSlug: slug, version: pack.version, provenance: pack.provenance,
      }).onConflictDoUpdate({
        target: [packInstallations.projectId, packInstallations.packSlug],
        set: { version: pack.version, provenance: pack.provenance, updatedAt: new Date() },
      });
    }
    for (const [key, slot] of Object.entries(document.resourceSlots)) {
      if (slot.resourceType && slot.resourceType !== slot.kind) {
        throw new BadRequestException(`resource slot "${key}" is ${slot.kind}, not ${slot.resourceType}`);
      }
      const known = slot.resourceType === "repo"
        ? resources.repoIds
        : slot.resourceType === "environment"
          ? resources.environmentIds
          : slot.resourceType === "mcp" || slot.resourceType === "deployment"
            ? resources.mcpIds
            : new Map<string, string>();
      if (slot.resource && slot.resourceType !== "folder") {
        requireDefined(known, slot.resource, `resource slot "${key}"`);
      }
      const resourceId = slot.resource
        ? slot.resourceType === "folder"
          ? slot.resource
          : known.get(slot.resource)!
        : null;
      await this.db.insert(projectResourceSlots).values({
        projectId,
        blueprintSlug: slot.blueprint,
        slotKey: key,
        definition: { key, label: slot.label, kind: slot.kind, required: slot.required, description: slot.description },
        resourceType: slot.resourceType,
        resourceId,
        resolvedAt: resourceId ? new Date() : null,
      }).onConflictDoUpdate({
        target: [projectResourceSlots.projectId, projectResourceSlots.slotKey],
        set: {
          blueprintSlug: slot.blueprint,
          definition: { key, label: slot.label, kind: slot.kind, required: slot.required, description: slot.description },
          resourceType: slot.resourceType,
          resourceId,
          resolvedAt: resourceId ? new Date() : null,
        },
      });
    }
  }

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

  /**
   * What each MCP connection points at right now.
   *
   * Read by `push` **before** any upsert runs, because that is the only moment
   * the previous state still exists: `upsertSecrets` happens first, so reading
   * the providerRef inside `upsertMcp` compares the new value with itself and
   * a repointed secret never invalidates its verification.
   */
  async mcpEndpoints(projectId: string): Promise<Map<string, McpEndpoint>> {
    const rows = await this.db
      .select({
        name: mcpConnections.name,
        url: mcpConnections.url,
        credentialSecretId: mcpConnections.credentialSecretId,
        // The secret's *target*, not just its id. A push can leave a secret's
        // id alone and repoint its `providerRef` at a different variable, which
        // means the connection resolves a different credential while looking
        // unchanged.
        providerRef: secretRefs.providerRef,
      })
      .from(mcpConnections)
      .leftJoin(secretRefs, eq(secretRefs.id, mcpConnections.credentialSecretId))
      .where(eq(mcpConnections.projectId, projectId));
    return new Map(rows.map((row) => [row.name, row]));
  }

  async upsertMcp(
    projectId: string,
    document: AgentosDocument,
    secretIds: Map<string, string>,
    before: Map<string, McpEndpoint>,
  ): Promise<Map<string, string>> {
    const ids = new Map<string, string>();

    for (const [name, connection] of Object.entries(document.mcp)) {
      // A credential name the document does not define used to resolve to
      // `null`, which is not "no credential" — it is a typo silently becoming
      // an unauthenticated connection that fails on its first call, and a
      // `pull` that no longer matches the file that was pushed.
      requireDefined(secretIds, connection.credential, `mcp "${name}" credential`);
      const [row] = await this.db
        .insert(mcpConnections)
        .values({
          projectId,
          name,
          url: connection.url,
          allowedOperations: connection.allowedOperations,
          credentialSecretId: connection.credential ? (secretIds.get(connection.credential) ?? null) : null,
          provenance: connection.provenance,
        })
        .onConflictDoUpdate({
          target: [mcpConnections.projectId, mcpConnections.name],
          set: {
            url: connection.url,
            allowedOperations: connection.allowedOperations,
            credentialSecretId: connection.credential
              ? (secretIds.get(connection.credential) ?? null)
              : null,
            provenance: connection.provenance,
            updatedAt: new Date(),
          },
        })
        .returning();
      ids.set(name, row!.id);

      // A verification is a statement about a URL and a credential, and this is
      // the second door that can change either. The REST path already cleared
      // it; `agentos push` did not, so a connection could be repointed at a
      // different server through the file and keep its green tick.
      const credentialId = connection.credential
        ? (secretIds.get(connection.credential) ?? null)
        : null;
      const providerRef = connection.credential
        ? (document.secrets[connection.credential]?.providerRef ?? null)
        : null;
      if (
        before.has(name) &&
        !sameEndpoint(before.get(name)!, connection.url, credentialId, providerRef)
      ) {
        await this.db
          .update(mcpConnections)
          .set({ verifiedAt: null, verifiedTools: [], verifyError: null })
          .where(eq(mcpConnections.id, row!.id));
      }
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
      requireDefined(secretIds, repo.credential, `repo "${name}" credential`);
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
          description: skill.description,
          category: skill.category,
          kind: skill.kind,
          body: skill.body,
          filePath: skill.filePath,
          provenance: skill.provenance,
          builtIn: skill.builtIn,
        })
        .onConflictDoUpdate({
          target: [skills.projectId, skills.slug],
          set: {
            name: skill.name,
            description: skill.description,
            category: skill.category,
            kind: skill.kind,
            body: skill.body,
            filePath: skill.filePath,
            provenance: skill.provenance,
            builtIn: skill.builtIn,
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
          provenance: template.provenance,
          builtIn: template.builtIn,
        })
        .onConflictDoUpdate({
          target: [taskTemplates.projectId, taskTemplates.name],
          set: {
            description: template.description,
            variables: template.variables,
            steps: template.steps,
            provenance: template.provenance,
            builtIn: template.builtIn,
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

      requireDefined(context.environmentIds, agent.environment, `agent "${name}" environment`);

      const values = {
        projectId,
        name,
        title: agent.title,
        description: agent.description,
        category: agent.category,
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
        provenance: agent.provenance,
        builtIn: agent.builtIn,
        recommendedSkillsInitialized: true,
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
