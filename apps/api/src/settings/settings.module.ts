import { Module } from "@nestjs/common";
import { ProjectsModule } from "../projects/projects.module";
import { QueueModule } from "../queue/queue.module";
import { SettingsController } from "./settings.controller";
import { SettingsService } from "./settings.service";

@Module({
  imports: [ProjectsModule, QueueModule],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
