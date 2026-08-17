import { type PreflightReport, type RunPreflightInput, runPreflightSchema } from "@agentos/shared";
import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { OperatorGuard } from "../auth/operator.guard";
import { ZodBody } from "../common/zod-body.pipe";
import { PreflightService } from "./preflight.service";
import { RUNNER_CAPABILITIES } from "./runner-capabilities";

@Controller("projects/:projectId/capabilities")
@UseGuards(OperatorGuard)
export class CapabilitiesController {
  constructor(private readonly preflight: PreflightService) {}

  @Get("matrix")
  matrix() {
    return RUNNER_CAPABILITIES;
  }

  /**
   * The same rule as the POST body, applied to the query.
   *
   * `subjectId` reaches a `uuid` equality and the `uuid` column of
   * `preflight_checks`, so an unparseable value came back as a 500 — a client
   * mistake reported as a broken server. `subjectType` was an unchecked cast
   * that silently degraded a typo to `project` and answered a question nobody
   * asked. Both are validated by the schema that already exists.
   */
  @Get("preflight")
  run(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Query("subjectType") subjectType?: string,
    @Query("subjectId") subjectId?: string,
  ): Promise<PreflightReport> {
    const parsed = runPreflightSchema.safeParse({
      ...(subjectType === undefined ? {} : { subjectType }),
      ...(subjectId === undefined || subjectId === "" ? {} : { subjectId }),
    });
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? "invalid preflight query");
    }
    return this.preflight.run(projectId, parsed.data.subjectType, parsed.data.subjectId);
  }

  @Post("preflight")
  runWithInputs(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Body(new ZodBody(runPreflightSchema)) body: RunPreflightInput,
  ): Promise<PreflightReport> {
    return this.preflight.run(projectId, body.subjectType, body.subjectId, body.inputs);
  }
}
