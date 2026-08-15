import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { Worker } from "bullmq";
import type IORedis from "ioredis";
import { APP_CONFIG, type AppConfig } from "../config/config";
import { SESSION_QUEUE_NAME, type SessionJob, SessionQueue } from "../queue/session.queue";
import { REDIS } from "../queue/tokens";
import { AutomationsService } from "../automations/automations.service";
import { GoalOrchestrator } from "../goals/goal-orchestrator";
import { MaintenanceService } from "../runner/maintenance.service";
import { SessionOrchestrator } from "../runner/session-orchestrator";
import { ERROR_REPORTER, type ErrorReporter } from "../observability/error-reporter";
import { SettingsService } from "../settings/settings.service";

/**
 * Runs in-process with the API. Single-operator scale does not justify a
 * separate deployable, and the orchestrator has to hold a live event stream
 * per running session anyway.
 *
 * Concurrency is deliberately low: each job holds an SSE connection open for
 * the life of a run.
 */
@Injectable()
export class SessionWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SessionWorker.name);
  private worker: Worker<SessionJob> | null = null;

  constructor(
    @Inject(REDIS) private readonly connection: IORedis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly orchestrator: SessionOrchestrator,
    private readonly goals: GoalOrchestrator,
    private readonly automations: AutomationsService,
    private readonly maintenance: MaintenanceService,
    private readonly queue: SessionQueue,
    private readonly settings: SettingsService,
    @Inject(ERROR_REPORTER) private readonly errors: ErrorReporter,
  ) {}

  onModuleInit(): void {
    const disabled =
      this.config.AGENTOS_DISABLE_WORKER === "1" || this.config.AGENTOS_DISABLE_WORKER === "true";
    if (disabled) {
      this.logger.warn("session worker disabled by AGENTOS_DISABLE_WORKER");
      return;
    }

    this.worker = new Worker<SessionJob>(
      SESSION_QUEUE_NAME,
      async (job) => {
        const data = job.data;
        switch (data.kind) {
          case "run-task":
            await this.orchestrator.runTask(data.taskId);
            return;
          case "resume-session":
            await this.orchestrator.resumeSession(data.sessionId, data.inboxMessageId);
            return;
          case "goal-iteration":
            await this.goals.runIteration(data.goalId);
            return;
          case "automation-fire":
            await this.automations.fire(data.automationId);
            return;
          case "maintenance": {
            const { reaped, swept, vaultsCleared, released, goalsRecovered } =
              await this.maintenance.run();
            if (reaped || swept || vaultsCleared || released || goalsRecovered) {
              this.logger.log(
                `maintenance: reaped ${reaped} parked, swept ${swept} orphaned, ` +
                  `cleaned ${vaultsCleared} stranded vault set(s), ` +
                  `re-released ${released} chain step(s), ` +
                  `re-queued ${goalsRecovered} stalled goal(s)`,
              );
            }
            return;
          }
        }
      },
      { connection: this.connection, concurrency: 4 },
    );

    // The heartbeat has to exist before anything can expire. The interval is
    // the shortest any project asks for, and each pass re-reads per-project
    // policy, so one schedule serves them all.
    void this.startMaintenance();

    // Jobs get one attempt (a container is expensive and side-effecting), so a
    // failure here is final: this is the last chance anyone hears about it.
    this.worker.on("failed", (job, error) => {
      this.errors.capture(error, {
        scope: "worker.job",
        tags: { jobId: job?.id ?? null, kind: job?.data?.kind ?? null },
      });
    });
    this.logger.log(`session worker listening on ${SESSION_QUEUE_NAME}`);
  }

  private async startMaintenance(): Promise<void> {
    try {
      await this.queue.scheduleMaintenance(await this.settings.shortestSweepInterval());
    } catch (error) {
      // Non-fatal: sessions still run. But nothing will reclaim a container
      // whose operator never answers, so this must not pass quietly.
      this.errors.capture(error, { scope: "worker.maintenance-schedule" });
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
