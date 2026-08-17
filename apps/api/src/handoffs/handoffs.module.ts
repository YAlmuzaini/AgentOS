import { Global, Module } from "@nestjs/common";
import { FilesModule } from "../files/files.module";
import { ProjectsModule } from "../projects/projects.module";
import { HandoffsController } from "./handoffs.controller";
import { HandoffsService } from "./handoffs.service";

@Global()
@Module({ imports: [FilesModule, ProjectsModule], controllers: [HandoffsController], providers: [HandoffsService], exports: [HandoffsService] })
export class HandoffsModule {}
