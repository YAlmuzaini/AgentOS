import { Module } from "@nestjs/common";
import { AgentsModule } from "../agents/agents.module";
import { FilesModule } from "../files/files.module";
import { InboxModule } from "../inbox/inbox.module";
import { PushModule } from "../push/push.module";
import { ResourcesModule } from "../resources/resources.module";
import { GithubModule } from "../github/github.module";
import { SecretsModule } from "../secrets/secrets.module";
import { SessionsModule } from "../sessions/sessions.module";
import { SettingsModule } from "../settings/settings.module";
import { TasksModule } from "../tasks/tasks.module";
import { GoalContinuity } from "../goals/goal-continuity";
import { CloudPublisher } from "./cloud-publisher";
import { CollaborationService } from "./collaboration";
import { InboxToolHandler } from "./inbox-tools";
import { CloudManagedAgentsRunner } from "./cloud-runner";
import { LocalVmRunner } from "./local-runner";
import { RunnerRouter } from "./runner-router";
import { RunnersController } from "./runners.controller";
import { ManifestResolver } from "./manifest";
import { RUNNER_CLOUD } from "./runner.types";
import { SessionConsumer } from "./session-consumer";
import { EnvironmentPolicyResolver } from "./environment-policy";
import { MaintenanceService } from "./maintenance.service";
import { OrphanSweep } from "./orphan-sweep";
import { VaultCleanup } from "./vault-cleanup";
import { SessionOrchestrator } from "./session-orchestrator";
import { SessionProvisioner } from "./session-provisioner";
import { SessionResumer } from "./session-resumer";
import { SessionTeardown } from "./session-teardown";
import { AgentToolHandler } from "./tool-handler";

/**
 * Consumer side of the queue. Depends on the domain; nothing depends on it.
 *
 * The runner is bound to a token rather than injected concretely so tests can
 * swap in a fake backend and exercise the whole session lifecycle without a
 * live container.
 */
@Module({
  imports: [
    AgentsModule,
    TasksModule,
    SessionsModule,
    InboxModule,
    SecretsModule,
    FilesModule,
    SettingsModule,
    PushModule,
    ResourcesModule,
    GithubModule,
  ],
  controllers: [RunnersController],
  providers: [
    CloudPublisher,
    { provide: RUNNER_CLOUD, useClass: CloudManagedAgentsRunner },
    LocalVmRunner,
    RunnerRouter,
    AgentToolHandler,
    InboxToolHandler,
    CollaborationService,
    ManifestResolver,
    SessionConsumer,
    EnvironmentPolicyResolver,
    SessionProvisioner,
    SessionTeardown,
    SessionResumer,
    SessionOrchestrator,
    MaintenanceService,
    GoalContinuity,
    OrphanSweep,
    VaultCleanup,
  ],
  exports: [SessionOrchestrator, MaintenanceService],
})
export class RunnerModule {}
