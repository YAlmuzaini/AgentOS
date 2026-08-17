import { Module } from "@nestjs/common";
import { ProjectsModule } from "../projects/projects.module";
import { BriefingController } from "./briefing.controller";
import { BriefingService } from "./briefing.service";

@Module({ imports: [ProjectsModule], controllers: [BriefingController], providers: [BriefingService] })
export class BriefingModule {}
