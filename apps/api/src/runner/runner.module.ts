import { Module } from "@nestjs/common";
import { AgentsModule } from "../agents/agents.module";
import { FilesModule } from "../files/files.module";
import { InboxModule } from "../inbox/inbox.module";
import { PushModule } from "../push/push.module";
import { SecretsModule } from "../secrets/secrets.module";
import { SessionsModule } from "../sessions/sessions.module";
import { SettingsModule } from "../settings/settings.module";
import { TasksModule } from "../tasks/tasks.module";
import { CloudPublisher } from "./cloud-publisher";
import { CloudManagedAgentsRunner } from "./cloud-runner";
import { LocalVmRunner } from "./local-runner";
import { RunnerRouter } from "./runner-router";
import { ManifestResolver } from "./manifest";
import { RUNNER_CLOUD } from "./runner.types";
import { SessionConsumer } from "./session-consumer";
import { EnvironmentPolicyResolver } from "./environment-policy";
import { MaintenanceService } from "./maintenance.service";
import { OrphanSweep } from "./orphan-sweep";
import { SessionOrchestrator } from "./session-orchestrator";
import { SessionProvisioner } from "./session-provisioner";
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
  ],
  providers: [
    CloudPublisher,
    { provide: RUNNER_CLOUD, useClass: CloudManagedAgentsRunner },
    LocalVmRunner,
    RunnerRouter,
    AgentToolHandler,
    ManifestResolver,
    SessionConsumer,
    EnvironmentPolicyResolver,
    SessionProvisioner,
    SessionTeardown,
    SessionOrchestrator,
    MaintenanceService,
    OrphanSweep,
  ],
  exports: [SessionOrchestrator, MaintenanceService],
})
export class RunnerModule {}
