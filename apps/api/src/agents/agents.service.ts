import { agents, type Database, packInstallations, skills } from "@agentos/db";
import {
  type AgentDto,
  builtInRoleInstalls,
  findPack,
  type CreateAgentInput,
  FOUNDATIONAL_PROMPT,
  originalAgentosProvenance,
  type UpdateAgentInput,
} from "@agentos/shared";
import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { DATABASE } from "../db/db.module";
import { ProjectsService } from "../projects/projects.service";

export type AgentRow = typeof agents.$inferSelect;

@Injectable()
export class AgentsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly projects: ProjectsService,
  ) {}

  async list(projectId: string): Promise<AgentDto[]> {
    await this.projects.require(projectId);
    const rows = await this.db
      .select()
      .from(agents)
      .where(eq(agents.projectId, projectId))
      .orderBy(agents.name);
    return rows.map(toDto);
  }

  async create(projectId: string, input: CreateAgentInput): Promise<AgentDto> {
    await this.projects.require(projectId);
    const clash = await this.db.query.agents.findFirst({
      where: and(eq(agents.projectId, projectId), eq(agents.name, input.name)),
    });
    if (clash) {
      throw new ConflictException(`agent "${input.name}" already exists in this project`);
    }

    const [row] = await this.db
      .insert(agents)
      .values({
        ...input,
        projectId,
        foundationalPrompt: input.foundationalPrompt ?? FOUNDATIONAL_PROMPT,
        provenance:
          input.provenance ?? originalAgentosProvenance("Operator-authored AgentOS role."),
      })
      .returning();
    return toDto(row!);
  }

  /**
   * Installs the built-in roles, so a new project is not fourteen forms away
   * from being usable (SPEC §4).
   *
   * Idempotent by name, and deliberately narrow about what it reconciles: it
   * refreshes the text *we* author — title and prompts — so a project picks up
   * an improved built-in prompt by running it again.
   *
   * It never touches `model`, `runnerPreference`, any grant, or the
   * **collaboration list**. That last one was in the reconciled set and should
   * not have been: a collaboration list is spawn authorisation, not content, so
   * an operator who removed `feasibility` from `review-coordinator` would have
   * had it silently restored by a re-install. It is set when the agent is
   * created and left alone afterwards.
   *
   * And it only updates rows it created. Reconciling purely by name meant an
   * operator's own agent called `plan` had its role prompt — which is its
   * behaviour — rewritten by an installer they ran for unrelated reasons.
   * `built_in` is the provenance marker that makes the difference visible.
   */
  async installBuiltIns(projectId: string, onlyNames?: string[]): Promise<AgentDto[]> {
    await this.projects.require(projectId);

    const wanted = onlyNames ? new Set(onlyNames) : null;
    const roles = builtInRoleInstalls().filter((role) => !wanted || wanted.has(role.name));

    // Which names already exist decides whether recommended skills are applied
    // at all: they are a starting point for a new agent, never a correction to
    // an existing one. Read once rather than per role.
    //
    // An agent installed before the skills existed therefore holds none, and
    // this button will not fix it — that backfill belongs to the moment the
    // skills arrive, and lives in `catalog.installBuiltInSkills`.
    const existing = new Set(
      (
        await this.db
          .select({ name: agents.name })
          .from(agents)
          .where(eq(agents.projectId, projectId))
      ).map((row) => row.name),
    );
    const skillIdBySlug = await this.skillIds(projectId);

    const installed: AgentDto[] = [];
    for (const role of roles) {
      // Recommendations, resolved against what this project actually has. A
      // slug whose skill is not installed is skipped rather than failing the
      // install — skills and agents are two buttons, pressed in either order.
      const recommended = existing.has(role.name)
        ? []
        : role.recommendedSkills.flatMap((slug) => {
            const id = skillIdBySlug.get(slug);
            return id ? [id] : [];
          });
      const recommendationsReady =
        (role.recommendedSkills.length === 0 || recommended.length === role.recommendedSkills.length);

      const [row] = await this.db
        .insert(agents)
        .values({
          ...role,
          projectId,
          builtIn: true,
          skillIds: recommended,
          recommendedSkillsInitialized: recommendationsReady,
        })
        .onConflictDoUpdate({
          target: [agents.projectId, agents.name],
          set: {
            title: role.title,
            // Description and category are ours to author, exactly like the
            // title: re-installing is how a project picks up a better one.
            description: role.description,
            category: role.category,
            foundationalPrompt: role.foundationalPrompt,
            rolePrompt: role.rolePrompt,
            // Provenance travels with the content it describes. A row upgraded
            // from before the column existed carries the `original` default,
            // which is wrong for the roles whose relationship is `inspired` —
            // and a claim about origin that is merely stale is a licensing
            // statement nobody can rely on. Guarded by the `setWhere` below:
            // an operator's own agent keeps its own provenance.
            provenance: role.provenance,
            updatedAt: new Date(),
          },
          // An operator's own agent with this name keeps everything it has.
          // `skillIds` is absent from this set on purpose: an operator who
          // removed a recommended skill meant it, and a re-install that put it
          // back would be the same bug as a re-seed rewriting a role prompt.
          setWhere: eq(agents.builtIn, true),
        })
        .returning();
      if (row) {
        installed.push(toDto(row));
      }
    }
    return installed;
  }

  /**
   * Installs one catalogue pack.
   *
   * A pack is a named subset of the same shipped roles, so this is
   * `installBuiltIns` with a filter rather than a second code path — which is
   * what keeps provenance, collision handling and the recommended-skill rule
   * identical between the two.
   */
  async installPack(projectId: string, slug: string): Promise<AgentDto[]> {
    const pack = findPack(slug);
    if (!pack) {
      throw new NotFoundException(`no catalogue pack named "${slug}"`);
    }
    const installed = await this.installBuiltIns(projectId, pack.roles);
    await this.recordPackInstallation(projectId, slug);
    return installed;
  }

  async recordPackInstallation(projectId: string, slug: string): Promise<void> {
    const pack = findPack(slug);
    if (!pack) throw new NotFoundException(`no catalogue pack named "${slug}"`);
    await this.db.insert(packInstallations).values({
      projectId,
      packSlug: pack.slug,
      version: pack.version,
      provenance: pack.provenance,
    }).onConflictDoUpdate({
      target: [packInstallations.projectId, packInstallations.packSlug],
      set: { version: pack.version, provenance: pack.provenance, updatedAt: new Date() },
    });
  }

  /** Slug → id for the skills this project has, for resolving recommendations. */
  private async skillIds(projectId: string): Promise<Map<string, string>> {
    const rows = await this.db
      .select({ id: skills.id, slug: skills.slug })
      .from(skills)
      .where(eq(skills.projectId, projectId));
    return new Map(rows.map((row) => [row.slug, row.id]));
  }

  async get(projectId: string, id: string): Promise<AgentDto> {
    return toDto(await this.require(projectId, id));
  }

  async update(projectId: string, id: string, input: UpdateAgentInput): Promise<AgentDto> {
    await this.require(projectId, id);
    const [row] = await this.db
      .update(agents)
      .set({
        ...input,
        ...(input.skillIds !== undefined ? { recommendedSkillsInitialized: true } : {}),
        // Any config edit invalidates the pinned runtime agent version; the
        // runner re-publishes on the next session (SPEC §4 Agent versioning).
        runtimeConfigHash: null,
        updatedAt: new Date(),
      })
      .where(eq(agents.id, id))
      .returning();
    return toDto(row!);
  }

  async require(projectId: string, id: string): Promise<AgentRow> {
    const row = await this.db.query.agents.findFirst({
      where: and(eq(agents.projectId, projectId), eq(agents.id, id)),
    });
    if (!row) {
      throw new NotFoundException(`agent ${id} not found in project ${projectId}`);
    }
    return row;
  }

  /** Non-throwing lookup, for callers that treat a missing role as "skip". */
  async findByName(projectId: string, name: string): Promise<AgentRow | undefined> {
    return this.db.query.agents.findFirst({
      where: and(eq(agents.projectId, projectId), eq(agents.name, name)),
    });
  }

  /** Dispatch by role name — how the goal orchestrator names a specialist. */
  async requireByName(projectId: string, name: string): Promise<AgentRow> {
    const row = await this.db.query.agents.findFirst({
      where: and(eq(agents.projectId, projectId), eq(agents.name, name)),
    });
    if (!row) {
      throw new NotFoundException(`agent "${name}" not found in project ${projectId}`);
    }
    return row;
  }

  /** Used by the runner, which knows the agent id but not the project. */
  async requireById(id: string): Promise<AgentRow> {
    const row = await this.db.query.agents.findFirst({ where: eq(agents.id, id) });
    if (!row) {
      throw new NotFoundException(`agent ${id} not found`);
    }
    return row;
  }
}

export function toDto(row: AgentRow): AgentDto {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    title: row.title,
    description: row.description,
    category: row.category as AgentDto["category"],
    model: row.model,
    foundationalPrompt: row.foundationalPrompt,
    rolePrompt: row.rolePrompt,
    skillIds: row.skillIds,
    mcpConnectionIds: row.mcpConnectionIds,
    repoAccess: row.repoAccess,
    filesystemGrants: row.filesystemGrants,
    collaborationList: row.collaborationList,
    environmentId: row.environmentId,
    runnerPreference: row.runnerPreference,
    inboxAccess: row.inboxAccess,
    provenance: row.provenance,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
