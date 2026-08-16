import {
  agents,
  type Database,
  environments,
  mcpConnections,
  projects,
  repos,
  secretRefs,
  skills,
  taskTemplates,
} from "@agentos/db";
import {
  type AgentosDocument,
  agentosDocumentSchema,
  FOUNDATIONAL_PROMPT,
  type PushResult,
} from "@agentos/shared";
import { BadRequestException, Inject, Injectable, Logger } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { parse, stringify } from "yaml";
import { DATABASE } from "../db/db.module";
import { ProjectsService } from "../projects/projects.service";
import { DocumentWriter } from "./document-writer";

/**
 * YAML-as-code (SPEC §17).
 *
 * `pull` renders the project; `push` applies a document. Both go through the
 * same shape, and everything is keyed by name, so `push` then `pull` returns
 * the same file — which is the property SPEC §22.12 asks for and the reason
 * the file is safe to keep in git.
 */
@Injectable()
export class ProjectYamlService {
  private readonly logger = new Logger(ProjectYamlService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly projects: ProjectsService,
    private readonly writer: DocumentWriter,
  ) {}

  async pull(projectId: string): Promise<string> {
    const project = await this.projects.require(projectId);
    const document = await this.read(projectId, project.slug);
    return stringify(document, { sortMapEntries: true, lineWidth: 100 });
  }

  async read(projectId: string, slug: string): Promise<AgentosDocument> {
    const [environmentRows, secretRows, mcpRows, repoRows, skillRows, agentRows, templateRows] =
      await Promise.all([
        this.db.select().from(environments).where(eq(environments.projectId, projectId)),
        this.db.select().from(secretRefs).where(eq(secretRefs.projectId, projectId)),
        this.db.select().from(mcpConnections).where(eq(mcpConnections.projectId, projectId)),
        this.db.select().from(repos).where(eq(repos.projectId, projectId)),
        this.db.select().from(skills).where(eq(skills.projectId, projectId)),
        this.db.select().from(agents).where(eq(agents.projectId, projectId)),
        this.db.select().from(taskTemplates).where(eq(taskTemplates.projectId, projectId)),
      ]);

    const secretName = new Map(secretRows.map((row) => [row.id, row.name]));
    const environmentName = new Map(environmentRows.map((row) => [row.id, row.name]));
    const skillSlug = new Map(skillRows.map((row) => [row.id, row.slug]));
    const mcpName = new Map(mcpRows.map((row) => [row.id, row.name]));
    const repoName = new Map(repoRows.map((row) => [row.id, row.name]));
    const repoMount = new Map(repoRows.map((row) => [row.id, row.mountPath]));

    return agentosDocumentSchema.parse({
      project: slug,
      environments: Object.fromEntries(
        environmentRows.map((row) => [
          row.name,
          { networking: row.networking, allowedHosts: row.allowedHosts },
        ]),
      ),
      secrets: Object.fromEntries(
        secretRows.map((row) => [row.name, { providerRef: row.providerRef, purpose: row.purpose }]),
      ),
      mcp: Object.fromEntries(
        mcpRows.map((row) => [
          row.name,
          {
            url: row.url,
            allowedOperations: row.allowedOperations,
            credential: row.credentialSecretId ? (secretName.get(row.credentialSecretId) ?? null) : null,
          },
        ]),
      ),
      repos: Object.fromEntries(
        repoRows.map((row) => [
          row.name,
          {
            remoteUrl: row.remoteUrl,
            mountPath: row.mountPath,
            defaultBranch: row.defaultBranch,
            credential: row.credentialSecretId ? (secretName.get(row.credentialSecretId) ?? null) : null,
          },
        ]),
      ),
      skills: Object.fromEntries(
        skillRows.map((row) => [
          row.slug,
          { name: row.name, kind: row.kind, body: row.body, filePath: row.filePath },
        ]),
      ),
      agents: Object.fromEntries(
        agentRows.map((row) => [
          row.name,
          {
            title: row.title,
            model: row.model,
            prompt: row.rolePrompt,
            skills: row.skillIds.flatMap((id) => (skillSlug.has(id) ? [skillSlug.get(id)!] : [])),
            mcp: row.mcpConnectionIds.flatMap((id) => (mcpName.has(id) ? [mcpName.get(id)!] : [])),
            repos: row.repoAccess.flatMap((access) =>
              repoName.has(access.repoId)
                ? [
                    {
                      name: repoName.get(access.repoId)!,
                      mount: access.mountPath || repoMount.get(access.repoId)!,
                      permissions: access.permissions,
                    },
                  ]
                : [],
            ),
            filesystem: row.filesystemGrants,
            collaboration: row.collaborationList,
            environment: row.environmentId ? (environmentName.get(row.environmentId) ?? null) : null,
            runner: row.runnerPreference,
            inbox: row.inboxAccess,
          },
        ]),
      ),
      templates: Object.fromEntries(
        templateRows.map((row) => [
          row.name,
          { description: row.description, variables: row.variables, steps: row.steps },
        ]),
      ),
    });
  }

  /**
   * Applies a document. Resources are upserted by name in dependency order:
   * secrets, then environments, then the things that reference them, then
   * agents last because agents reference everything.
   */
  async push(projectId: string, yamlText: string): Promise<PushResult> {
    const project = await this.projects.require(projectId);
    const parsed = agentosDocumentSchema.safeParse(parse(yamlText));
    if (!parsed.success) {
      throw new BadRequestException({
        message: "agentos.yml is not valid",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }
    const document = parsed.data;
    if (document.project !== project.slug) {
      throw new BadRequestException(
        `this document is for project "${document.project}", not "${project.slug}"`,
      );
    }

    // Diff against the current state first so the report can say what actually
    // changed rather than claiming everything was touched.
    const before = await this.read(projectId, project.slug);
    const result: PushResult = { created: [], updated: [], skipped: [] };

    const secretIds = await this.writer.upsertSecrets(projectId, document);
    const environmentIds = await this.writer.upsertEnvironments(projectId, document);
    const mcpIds = await this.writer.upsertMcp(projectId, document, secretIds);
    const repoIds = await this.writer.upsertRepos(projectId, document, secretIds);
    const skillIds = await this.writer.upsertSkills(projectId, document);
    await this.writer.upsertTemplates(projectId, document);
    await this.writer.upsertAgents(projectId, document, {
      environmentIds,
      mcpIds,
      repoIds,
      skillIds,
    });

    // Stored so `pull` can hand back the exact text that was pushed. Only
    // within this push is the document authoritative — the rows it just wrote
    // are what a session reads, and the Agents screen writes to those rows
    // too, so a later push of a stale file overwrites those edits.
    await this.db
      .update(projects)
      .set({ yaml: yamlText, updatedAt: new Date() })
      .where(eq(projects.id, projectId));

    classify(before, document, result);
    this.logger.log(
      `push: ${result.created.length} created, ${result.updated.length} updated, ${result.skipped.length} unchanged`,
    );
    return result;
  }
}

/**
 * Splits the document into created / updated / unchanged by comparing it with
 * the state that was there before the push. `push` reporting nothing is a lie
 * an operator would only catch much later.
 */
function classify(before: AgentosDocument, after: AgentosDocument, result: PushResult): void {
  const groups: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
    ["secret", before.secrets, after.secrets],
    ["environment", before.environments, after.environments],
    ["mcp", before.mcp, after.mcp],
    ["repo", before.repos, after.repos],
    ["skill", before.skills, after.skills],
    ["template", before.templates, after.templates],
    ["agent", before.agents, after.agents],
  ];

  for (const [kind, previous, next] of groups) {
    for (const [name, value] of Object.entries(next)) {
      const label = `${kind}:${name}`;
      if (!(name in previous)) {
        result.created.push(label);
      } else if (JSON.stringify(previous[name]) !== JSON.stringify(value)) {
        result.updated.push(label);
      } else {
        result.skipped.push(label);
      }
    }
  }
}
