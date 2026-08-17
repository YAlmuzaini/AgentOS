import { agents, type Database, taskTemplates } from "@agentos/db";
import {
  BUILT_IN_TEMPLATES,
  type CreateTemplateInput,
  type InstantiateTemplateInput,
  interpolate,
  matchesKnownBuiltInShape,
  missingVariables,
  type TaskDto,
  type TaskTemplateDto,
  originalAgentosProvenance,
} from "@agentos/shared";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { DATABASE } from "../db/db.module";
import { ProjectsService } from "../projects/projects.service";
import { PreflightService } from "../capabilities/preflight.service";
import { SessionQueue } from "../queue/session.queue";
import { TasksService } from "../tasks/tasks.service";

type TemplateRow = typeof taskTemplates.$inferSelect;

@Injectable()
export class TemplatesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly projects: ProjectsService,
    private readonly tasks: TasksService,
    private readonly queue: SessionQueue,
    private readonly preflight: PreflightService,
  ) {}

  async list(projectId: string): Promise<TaskTemplateDto[]> {
    await this.projects.require(projectId);
    const rows = await this.db
      .select()
      .from(taskTemplates)
      .where(eq(taskTemplates.projectId, projectId))
      .orderBy(taskTemplates.name);
    return rows.map(toDto);
  }

  async create(projectId: string, input: CreateTemplateInput): Promise<TaskTemplateDto> {
    await this.projects.require(projectId);
    const clash = await this.db.query.taskTemplates.findFirst({
      where: and(eq(taskTemplates.projectId, projectId), eq(taskTemplates.name, input.name)),
    });
    if (clash) {
      throw new ConflictException(`template "${input.name}" already exists`);
    }
    const [row] = await this.db
      .insert(taskTemplates)
      .values({
        ...input,
        projectId,
        provenance:
          input.provenance ?? originalAgentosProvenance("Operator-authored AgentOS workflow."),
      })
      .returning();
    return toDto(row!);
  }

  /**
   * Installs the built-in workflows. Idempotent.
   *
   * Runs the legacy-adoption pass first (see `adoptLegacyBuiltIn`), so a
   * shipped workflow installed before the ownership column existed picks up
   * corrected catalogue wiring instead of being frozen as the operator's.
   */
  async installBuiltIns(projectId: string, onlyNames?: string[]): Promise<TaskTemplateDto[]> {
    const installed: TaskTemplateDto[] = [];
    const wanted = onlyNames ? new Set(onlyNames) : null;
    const provenance = originalAgentosProvenance("Original AgentOS built-in workflow.");
    for (const template of BUILT_IN_TEMPLATES.filter((entry) => !wanted || wanted.has(entry.name))) {
      await this.adoptLegacyBuiltIn(projectId, template.name);
      const [row] = await this.db
        .insert(taskTemplates)
        .values({
          ...template,
          projectId,
          builtIn: true,
          provenance,
        })
        .onConflictDoUpdate({
          target: [taskTemplates.projectId, taskTemplates.name],
          set: {
            description: template.description,
            variables: template.variables,
            steps: template.steps,
            // Refreshed with the content it describes, and only on a row this
            // installer owns — the `setWhere` below is what keeps an
            // operator-authored workflow's own provenance intact.
            provenance,
            updatedAt: new Date(),
          },
          setWhere: eq(taskTemplates.builtIn, true),
        })
        .returning();
      const present =
        row ??
        (await this.db.query.taskTemplates.findFirst({
          where: and(
            eq(taskTemplates.projectId, projectId),
            eq(taskTemplates.name, template.name),
          ),
        }));
      if (present) installed.push(toDto(present));
    }
    return installed;
  }

  /**
   * Marks an unedited pre-0023 built-in row as catalogue-owned.
   *
   * Ownership is decided by content, never by name. The row is adopted only if
   * its description, variables and every step match a shape the catalogue has
   * actually shipped (`matchesKnownBuiltInShape`). A workflow the operator
   * wrote that happens to share a built-in's name, and a shipped workflow with
   * one word changed in one prompt, both fail that test and stay theirs — the
   * update below is a no-op for them, and the installer's `setWhere` then
   * refuses to touch them for good.
   */
  private async adoptLegacyBuiltIn(projectId: string, name: string): Promise<void> {
    const row = await this.db.query.taskTemplates.findFirst({
      where: and(eq(taskTemplates.projectId, projectId), eq(taskTemplates.name, name)),
    });
    if (!row || row.builtIn) return;
    if (!matchesKnownBuiltInShape(row)) return;
    await this.db
      .update(taskTemplates)
      .set({ builtIn: true })
      // Re-checked in the predicate: two installs racing must not both decide
      // they are the one adopting the row.
      .where(and(eq(taskTemplates.id, row.id), eq(taskTemplates.builtIn, false)));
  }

  /**
   * Creates the whole chain up front and releases only step 0.
   *
   * Every card exists immediately so the operator can see the shape of the
   * work, but ordering is enforced by the chain scheduler rather than by
   * hiding the cards.
   */
  async instantiate(
    projectId: string,
    templateId: string,
    input: InstantiateTemplateInput,
  ): Promise<TaskDto[]> {
    const template = await this.require(projectId, templateId);
    const missing = missingVariables(template.variables, input.variables);
    if (missing.length > 0) {
      throw new BadRequestException(`missing template variables: ${missing.join(", ")}`);
    }

    await this.preflight.assertReady(
      projectId,
      "template",
      templateId,
      input.acknowledgePreflightWarnings,
      input.variables,
    );

    const roster = await this.db
      .select({ id: agents.id, name: agents.name })
      .from(agents)
      .where(eq(agents.projectId, projectId));

    const chainId = randomUUID();
    const created: TaskDto[] = [];

    for (const [index, step] of template.steps.entries()) {
      const isHuman = step.agentName === "human";
      const agent = roster.find((candidate) => candidate.name === step.agentName);
      if (!isHuman && !agent) {
        throw new BadRequestException(
          `template step "${step.name}" needs agent "${step.agentName}", which this project does not have`,
        );
      }

      const prefix = input.titlePrefix.trim();
      const task = await this.tasks.createChained(
        projectId,
        {
          name: `${prefix ? `${prefix} · ` : ""}${interpolate(step.name, input.variables)}`,
          description: interpolate(step.prompt, input.variables),
          assigneeType: isHuman ? "human" : "agent",
          assigneeAgentId: isHuman ? null : agent!.id,
          attachmentIds: [],
          approvalGate: step.approvalGate,
          scheduleKind: "now",
          runAt: null,
          cron: null,
          timezone: null,
        },
        { chainId, chainIndex: index, templateId: template.id },
      );
      created.push(task);
    }

    const first = created[0];
    if (first && first.assigneeType === "agent") {
      await this.queue.enqueueRun(first.id);
    }
    return created;
  }

  async require(projectId: string, id: string): Promise<TemplateRow> {
    const row = await this.db.query.taskTemplates.findFirst({
      where: and(eq(taskTemplates.projectId, projectId), eq(taskTemplates.id, id)),
    });
    if (!row) {
      throw new NotFoundException(`template ${id} not found`);
    }
    return row;
  }

  /**
   * Removes one template. Chains already instantiated from it keep running: a template is a mould, not
   * a parent.
   */
  async remove(projectId: string, id: string): Promise<void> {
    const [row] = await this.db
      .select({ id: taskTemplates.id })
      .from(taskTemplates)
      .where(and(eq(taskTemplates.projectId, projectId), eq(taskTemplates.id, id)));
    if (!row) {
      throw new NotFoundException(`template ${id} not found`);
    }
    await this.db.delete(taskTemplates).where(eq(taskTemplates.id, id));
  }
}

function toDto(row: TemplateRow): TaskTemplateDto {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    description: row.description,
    variables: row.variables,
    steps: row.steps,
    provenance: row.provenance,
  };
}
