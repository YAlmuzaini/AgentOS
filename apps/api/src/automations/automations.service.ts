import { automations, type Database } from "@agentos/db";
import type { AutomationDto, CreateAutomationInput } from "@agentos/shared";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { AgentsService } from "../agents/agents.service";
import { DATABASE } from "../db/db.module";
import { ProjectsService } from "../projects/projects.service";
import { SessionQueue } from "../queue/session.queue";
import { TasksService } from "../tasks/tasks.service";
import { TemplatesService } from "../templates/templates.service";

type AutomationRow = typeof automations.$inferSelect;

/**
 * Named cron entries (SPEC §15).
 *
 * Schedules live in the queue, not in memory, so a restart does not drop them;
 * the service re-asserts every enabled automation on boot in case Redis was
 * cleared underneath it.
 */
@Injectable()
export class AutomationsService implements OnModuleInit {
  private readonly logger = new Logger(AutomationsService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly projects: ProjectsService,
    private readonly agents: AgentsService,
    private readonly tasks: TasksService,
    private readonly templates: TemplatesService,
    private readonly queue: SessionQueue,
  ) {}

  async onModuleInit(): Promise<void> {
    const rows = await this.db.select().from(automations).where(eq(automations.enabled, true));
    for (const row of rows) {
      await this.queue.scheduleAutomation(row.id, row.cron, row.timezone);
    }
    if (rows.length > 0) {
      this.logger.log(`re-asserted ${rows.length} automation schedules`);
    }
  }

  async list(projectId: string): Promise<AutomationDto[]> {
    await this.projects.require(projectId);
    const rows = await this.db
      .select()
      .from(automations)
      .where(eq(automations.projectId, projectId))
      .orderBy(automations.name);
    return rows.map(toDto);
  }

  async create(projectId: string, input: CreateAutomationInput): Promise<AutomationDto> {
    await this.projects.require(projectId);
    if (input.agentId) {
      await this.agents.require(projectId, input.agentId);
    }
    if (input.taskTemplateId) {
      await this.templates.require(projectId, input.taskTemplateId);
    }
    const clash = await this.db.query.automations.findFirst({
      where: and(eq(automations.projectId, projectId), eq(automations.name, input.name)),
    });
    if (clash) {
      throw new ConflictException(`automation "${input.name}" already exists`);
    }

    const [row] = await this.db
      .insert(automations)
      .values({ ...input, projectId })
      .returning();

    if (row!.enabled) {
      await this.queue.scheduleAutomation(row!.id, row!.cron, row!.timezone);
    }
    return toDto(row!);
  }

  async setEnabled(projectId: string, id: string, enabled: boolean): Promise<AutomationDto> {
    await this.require(projectId, id);
    const [row] = await this.db
      .update(automations)
      .set({ enabled, updatedAt: new Date() })
      .where(eq(automations.id, id))
      .returning();

    if (enabled) {
      await this.queue.scheduleAutomation(row!.id, row!.cron, row!.timezone);
    } else {
      await this.queue.cancelAutomation(row!.id);
    }
    return toDto(row!);
  }

  /**
   * Fires one occurrence: creates the work and lets the normal task path run
   * it. An automation never talks to the runner directly.
   */
  async fire(automationId: string): Promise<{ taskIds: string[] }> {
    const row = await this.db.query.automations.findFirst({
      where: eq(automations.id, automationId),
    });
    if (!row) {
      // The row is gone but the schedule survived: clean up rather than loop.
      await this.queue.cancelAutomation(automationId);
      throw new NotFoundException(`automation ${automationId} no longer exists`);
    }
    if (!row.enabled) {
      return { taskIds: [] };
    }

    let taskIds: string[];
    if (row.taskTemplateId) {
      const created = await this.templates.instantiate(row.projectId, row.taskTemplateId, {
        variables: row.templateVariables,
        titlePrefix: row.name,
      });
      taskIds = created.map((task) => task.id);
    } else {
      if (!row.agentId) {
        throw new BadRequestException(`automation ${row.name} has neither a template nor an agent`);
      }
      const task = await this.tasks.create(row.projectId, {
        name: row.taskName || row.name,
        description: row.taskBody,
        assigneeType: "agent",
        assigneeAgentId: row.agentId,
        attachmentIds: [],
        approvalGate: false,
        scheduleKind: "now",
        runAt: null,
        cron: null,
        timezone: null,
      });
      taskIds = [task.id];
    }

    await this.db
      .update(automations)
      .set({ lastFiredAt: new Date() })
      .where(eq(automations.id, automationId));

    this.logger.log(`automation ${row.name} fired → ${taskIds.length} task(s)`);
    return { taskIds };
  }

  async require(projectId: string, id: string): Promise<AutomationRow> {
    const row = await this.db.query.automations.findFirst({
      where: and(eq(automations.projectId, projectId), eq(automations.id, id)),
    });
    if (!row) {
      throw new NotFoundException(`automation ${id} not found`);
    }
    return row;
  }
}

function toDto(row: AutomationRow): AutomationDto {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    cron: row.cron,
    timezone: row.timezone,
    agentId: row.agentId,
    taskTemplateId: row.taskTemplateId,
    taskName: row.taskName,
    taskBody: row.taskBody,
    templateVariables: row.templateVariables,
    enabled: row.enabled,
    lastFiredAt: row.lastFiredAt?.toISOString() ?? null,
  };
}
