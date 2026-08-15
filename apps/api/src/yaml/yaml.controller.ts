import type { PushResult } from "@agentos/shared";
import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Put, UseGuards } from "@nestjs/common";
import { OperatorGuard } from "../auth/operator.guard";
import { ProjectYamlService } from "./project-yaml.service";

/**
 * `pull` returns the document as text/yaml; `push` takes it back. The CLI and
 * the UI both use these two routes and nothing else (SPEC §17, §20).
 */
@Controller("projects/:projectId/yaml")
@UseGuards(OperatorGuard)
export class YamlController {
  constructor(private readonly yaml: ProjectYamlService) {}

  @Get()
  @Header("content-type", "text/yaml; charset=utf-8")
  pull(@Param("projectId", ParseUUIDPipe) projectId: string): Promise<string> {
    return this.yaml.pull(projectId);
  }

  @Put()
  push(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Body() body: { yaml?: string },
  ): Promise<PushResult> {
    return this.yaml.push(projectId, body?.yaml ?? "");
  }
}
