import { Module } from "@nestjs/common";
import { AutomationsModule } from "../automations/automations.module";
import { GoalsModule } from "../goals/goals.module";
import { RunnerModule } from "../runner/runner.module";
import { SettingsModule } from "../settings/settings.module";
import { SessionWorker } from "./session.worker";

/**
 * The only consumer of the queue, and the only place that knows about every
 * job kind. Kept above both the runner and the goal loop so neither has to
 * import the other.
 */
@Module({
  imports: [RunnerModule, GoalsModule, AutomationsModule, SettingsModule],
  providers: [SessionWorker],
})
export class WorkerModule {}
