import { type Database, triggerFires, triggers } from "@agentos/db";
import { sanitizeWebhookPayload } from "@agentos/shared";
import { Inject, Injectable, Logger, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { APP_CONFIG, type AppConfig } from "../config/config";
import { DATABASE } from "../db/db.module";
import { TasksService } from "../tasks/tasks.service";
import { normaliseSignature, signingKeyFor, verifySignature } from "./webhook-signature";

/** Postgres 23505, wrapped by drizzle, so the code lives on the cause. */
function isUniqueViolation(error: unknown): boolean {
  for (let current = error; current != null; current = (current as { cause?: unknown }).cause) {
    if (typeof current === "object" && "code" in current && current.code === "23505") {
      return true;
    }
  }
  return false;
}

/**
 * One inbound webhook delivery, start to finish.
 *
 * Split out of TriggersService because this path is the security-critical one —
 * verify, claim exactly once, dispatch, and undo the claim if dispatch fails —
 * and it deserves to be read on its own.
 */
@Injectable()
export class DeliveryHandler {
  private readonly logger = new Logger(DeliveryHandler.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly tasks: TasksService,
  ) {}

  /**
   * Handles one inbound delivery: verify, then spawn exactly one scoped job.
   *
   * A rejected delivery is recorded too — a webhook that silently stops
   * working is worse than one that visibly fails.
   */
  async handle(input: {
    triggerId: string;
    rawBody: string;
    signature: string | undefined;
    timestamp: string | undefined;
  }): Promise<{ taskId: string }> {
    const row = await this.db.query.triggers.findFirst({
      where: eq(triggers.id, input.triggerId),
    });
    if (!row) {
      throw new NotFoundException("unknown trigger");
    }

    const verdict = verifySignature({
      signingKey: signingKeyFor(this.config, row),
      rawBody: input.rawBody,
      signature: input.signature,
      timestamp: input.timestamp,
    });
    if (!verdict.ok) {
      await this.recordFire(row.id, false, verdict.reason, null);
      throw new UnauthorizedException(verdict.reason);
    }
    if (!row.enabled) {
      await this.recordFire(row.id, false, "trigger is disabled", null);
      throw new UnauthorizedException("trigger is disabled");
    }

    // Claim the delivery, then re-verify against the salt as it stands *now*.
    //
    // The first verification used a row read before this point. If the operator
    // rotated the secret in between, that check passed against a key that no
    // longer exists — "rotation invalidates the old key immediately" has to
    // mean immediately, not "unless a request was already in flight".
    // verifySignature has already rejected a missing header by this point.
    const signature = normaliseSignature(input.signature ?? "");
    let fireId: string;
    try {
      fireId = await this.db.transaction(async (tx) => {
        // `FOR UPDATE`, not a plain read. Under READ COMMITTED a rotation
        // committing between this select and the insert would still be missed;
        // the lock makes rotation wait, so "rotation invalidates the old key
        // immediately" holds even against a delivery already in flight.
        const [current] = await tx
          .select()
          .from(triggers)
          .where(eq(triggers.id, row.id))
          .for("update");
        if (!current) {
          throw new NotFoundException("unknown trigger");
        }
        const recheck = verifySignature({
          signingKey: signingKeyFor(this.config, current),
          rawBody: input.rawBody,
          signature: input.signature,
          timestamp: input.timestamp,
        });
        if (!recheck.ok) {
          throw new UnauthorizedException(recheck.reason);
        }
        const [fire] = await tx
          .insert(triggerFires)
          .values({ triggerId: row.id, accepted: true, reason: null, taskId: null, signature })
          .returning();
        return fire!.id;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        this.logger.warn(`trigger ${row.name}: replayed delivery rejected`);
        await this.recordFire(row.id, false, "delivery was already processed", null);
        throw new UnauthorizedException("delivery was already processed");
      }
      if (error instanceof UnauthorizedException) {
        await this.recordFire(row.id, false, "the signing secret was rotated mid-delivery", null);
      }
      throw error;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(input.rawBody || "{}");
    } catch {
      payload = { raw: input.rawBody };
    }

    // If the job cannot be created, the claim is released. A spent signature
    // with no task is the worst outcome available: the sender's retry would be
    // rejected as a replay and the event would be lost with nothing to show
    // for it. Better to let the retry through than to swallow the delivery.
    let task: { id: string };
    try {
      task = await this.tasks.create(row.projectId, {
        name: `${row.name} · inbound`,
        description: [row.jobPrompt.trim(), "", "# Event", sanitizeWebhookPayload(payload)]
          .filter(Boolean)
          .join("\n"),
        assigneeType: "agent",
        assigneeAgentId: row.agentId,
        attachmentIds: [],
        approvalGate: false,
        scheduleKind: "now",
        runAt: null,
        cron: null,
        timezone: null,
      });
    } catch (error) {
      await this.db.delete(triggerFires).where(eq(triggerFires.id, fireId));
      this.logger.error(`trigger ${row.name}: claim released after a failed dispatch: ${String(error)}`);
      throw error;
    }

    await this.db
      .update(triggerFires)
      .set({ taskId: task.id })
      .where(eq(triggerFires.id, fireId));
    this.logger.log(`trigger ${row.name} fired → task ${task.id}`);
    return { taskId: task.id };
  }

  private async recordFire(
    triggerId: string,
    accepted: boolean,
    reason: string | null,
    taskId: string | null,
  ): Promise<void> {
    await this.db.insert(triggerFires).values({ triggerId, accepted, reason, taskId });
  }
}
