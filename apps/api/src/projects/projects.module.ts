import { Module } from "@nestjs/common";
// FilesModule imports nothing, so there is no cycle: deleting a project has to
// remove the stored objects it owns, not only their index rows.
import { FilesModule } from "../files/files.module";
import { ProjectsController } from "./projects.controller";
import { ProjectsService } from "./projects.service";

@Module({
  imports: [FilesModule],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
