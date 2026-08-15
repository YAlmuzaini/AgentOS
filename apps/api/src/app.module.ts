import { Module } from "@nestjs/common";
import { ActivityModule } from "./activity/activity.module";
import { AgentsModule } from "./agents/agents.module";
import { AutomationsModule } from "./automations/automations.module";
import { DbModule } from "./db/db.module";
import { FilesModule } from "./files/files.module";
import { GoalLogModule } from "./goals/goal-log.service";
import { GoalsModule } from "./goals/goals.module";
import { HealthController } from "./health.controller";
import { InboxModule } from "./inbox/inbox.module";
import { ProjectsModule } from "./projects/projects.module";
import { PushModule } from "./push/push.module";
import { QueueModule } from "./queue/queue.module";
import { ResourcesModule } from "./resources/resources.module";
import { RunnerModule } from "./runner/runner.module";
import { SecretsModule } from "./secrets/secrets.module";
import { SessionsModule } from "./sessions/sessions.module";
import { SettingsModule } from "./settings/settings.module";
import { TasksModule } from "./tasks/tasks.module";
import { TemplatesModule } from "./templates/templates.module";
import { TriggersModule } from "./triggers/triggers.module";
import { YamlModule } from "./yaml/yaml.module";
import { WorkerModule } from "./worker/worker.module";

@Module({
  imports: [
    DbModule,
    QueueModule,
    ProjectsModule,
    AgentsModule,
    TasksModule,
    TemplatesModule,
    SessionsModule,
    SettingsModule,
    InboxModule,
    SecretsModule,
    ResourcesModule,
    FilesModule,
    GoalLogModule,
    RunnerModule,
    GoalsModule,
    TriggersModule,
    AutomationsModule,
    YamlModule,
    ActivityModule,
    PushModule,
    WorkerModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
