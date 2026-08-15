import { Module } from "@nestjs/common";
import { ProjectsModule } from "../projects/projects.module";
import { DocumentWriter } from "./document-writer";
import { ProjectYamlService } from "./project-yaml.service";
import { YamlController } from "./yaml.controller";

@Module({
  imports: [ProjectsModule],
  controllers: [YamlController],
  providers: [DocumentWriter, ProjectYamlService],
  exports: [ProjectYamlService],
})
export class YamlModule {}
