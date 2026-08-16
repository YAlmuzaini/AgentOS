import { type Database, triggerFires, triggers } from "@agentos/db";
import {
  type CreateTriggerInput,
  sanitizeWebhookPayload,
  type TriggerDto,
  type TriggerFireDto,
  type TriggerSecretDto,
} from "@agentos/shared";
import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { AgentsService } from "../agents/agents.service";
import { APP_CONFIG, type AppConfig } from "../config/config";
import { DATABASE } from "../db/db.module";
import { ProjectsService } from "../projects/projects.service";
import { TasksService } from "../tasks/tasks.service";
import { EXAMPLE_TRIGGERS } from "./example-triggers";
import { DeliveryHandler } from "./delivery-handler";
import { newSalt, signingKeyFor } from "./webhook-signature";

/**
 * Postgres 23505. Drizzle wraps the driver error in its own "Failed query"
 * error, so the code lives on the cause rather than the error itself.
 */
function isUniqueViolation(error: unknown): boolean {
  for (let current = error; current != null; current = (current as { cause?: unknown }).cause) {
    if (typeof current === "object" && "code" in current && current.code === "23505") {
      return true;
    }
  }
  return false;
}

type TriggerRow = typeof triggers.$inferSelect;

@Injectable()
export class TriggersService {
  private readonly logger = new Logger(TriggersService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly projects: ProjectsService,
    private readonly agents: AgentsService,
    private readonly delivery: DeliveryHandler,
  ) {}

  async list(projectId: string): Promise<TriggerDto[]> {
    await this.projects.require(projectId);
    const rows = await this.db
      .select()
      .from(triggers)
      .where(eq(triggers.projectId, projectId))
      .orderBy(triggers.name);
    return rows.map((row) => this.toDto(row));
  }

  /** The signing key is returned here and nowhere else. */
  async create(projectId: string, input: CreateTriggerInput): Promise<TriggerSecretDto> {
    await this.projects.require(projectId);
    await this.agents.require(projectId, input.agentId);

    const clash = await this.db.query.triggers.findFirst({
      where: and(eq(triggers.projectId, projectId), eq(triggers.name, input.name)),
    });
    if (clash) {
      throw new ConflictException(`trigger "${input.name}" already exists`);
    }

    const salt = newSalt();
    const [row] = await this.db
      .insert(triggers)
      .values({ ...input, projectId, secretSalt: salt })
      .returning();

    return { ...this.toDto(row!), signingKey: this.signingKey(row!) };
  }

  /** Installs the examples in `example-triggers.ts`, if their agents exist. */
  async installExamples(projectId: string): Promise<TriggerSecretDto[]> {
    const installed: TriggerSecretDto[] = [];
    for (const example of EXAMPLE_TRIGGERS) {
      const existing = await this.db.query.triggers.findFirst({
        where: and(eq(triggers.projectId, projectId), eq(triggers.name, example.name)),
      });
      if (existing) {
        continue;
      }
      const agent = await this.agents.findByName(projectId, example.agentName);
      if (!agent) {
        this.logger.warn(
          `skipping example trigger "${example.name}": this project has no "${example.agentName}" agent`,
        );
        continue;
      }
      installed.push(
        await this.create(projectId, {
          name: example.name,
          agentId: agent.id,
          jobPrompt: example.jobPrompt,
          enabled: true,
        }),
      );
    }
    return installed;
  }

  /**
   * Rotation invalidates the old key immediately.
   *
   * Runs in a transaction that takes the same row lock a delivery takes, so
   * the two serialize: a delivery either completes entirely before the
   * rotation, or verifies against the new salt and fails.
   */
  async rotateSecret(projectId: string, id: string): Promise<TriggerSecretDto> {
    await this.require(projectId, id);
    const row = await this.db.transaction(async (tx) => {
      await tx.select().from(triggers).where(eq(triggers.id, id)).for("update");
      const [updated] = await tx
        .update(triggers)
        .set({ secretSalt: newSalt(), updatedAt: new Date() })
        .where(eq(triggers.id, id))
        .returning();
      return updated!;
    });
    return { ...this.toDto(row), signingKey: this.signingKey(row) };
  }

  async fires(projectId: string, id: string): Promise<TriggerFireDto[]> {
    await this.require(projectId, id);
    const rows = await this.db
      .select()
      .from(triggerFires)
      .where(eq(triggerFires.triggerId, id))
      .orderBy(desc(triggerFires.createdAt))
      .limit(50);
    return rows.map((row) => ({
      id: row.id,
      triggerId: row.triggerId,
      accepted: row.accepted,
      reason: row.reason,
      taskId: row.taskId,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async require(projectId: string, id: string): Promise<TriggerRow> {
    const row = await this.db.query.triggers.findFirst({
      where: and(eq(triggers.projectId, projectId), eq(triggers.id, id)),
    });
    if (!row) {
      throw new NotFoundException(`trigger ${id} not found`);
    }
    return row;
  }

  private async recordFire(
    triggerId: string,
    accepted: boolean,
    reason: string | null,
    taskId: string | null,
  ): Promise<void> {
    await this.db.insert(triggerFires).values({ triggerId, accepted, reason, taskId });
  }

  private signingKey(row: TriggerRow): string {
    return signingKeyFor(this.config, row);
  }

  /** Delegated so the delivery path can be read on its own. */
  handleDelivery(input: {
    triggerId: string;
    rawBody: string;
    signature: string | undefined;
    timestamp: string | undefined;
  }): Promise<{ taskId: string }> {
    return this.delivery.handle(input);
  }

  private toDto(row: TriggerRow): TriggerDto {
    return {
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      agentId: row.agentId,
      jobPrompt: row.jobPrompt,
      enabled: row.enabled,
      url: `${this.config.PUBLIC_URL.replace(/\/$/, "")}/hooks/${row.id}`,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /**
   * Removes one trigger. Its recorded fires go with it: they are that trigger's audit trail and mean
   * nothing without it.
   */
  async remove(projectId: string, id: string): Promise<void> {
    const [row] = await this.db
      .select({ id: triggers.id })
      .from(triggers)
      .where(and(eq(triggers.projectId, projectId), eq(triggers.id, id)));
    if (!row) {
      throw new NotFoundException(`trigger ${id} not found`);
    }
    await this.db.delete(triggers).where(eq(triggers.id, id));
  }
}
