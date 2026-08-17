import type { ExecutiveBriefingDto } from "@agentos/shared";
import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from "@nestjs/common";
import { OperatorGuard } from "../auth/operator.guard";
import { BriefingService } from "./briefing.service";

@Controller("projects/:projectId/briefing")
@UseGuards(OperatorGuard)
export class BriefingController {
  constructor(private readonly briefing: BriefingService) {}

  @Get()
  get(@Param("projectId", ParseUUIDPipe) projectId: string, @Query("since") since?: string): Promise<ExecutiveBriefingDto> {
    const parsed = since ? new Date(since) : undefined;
    return this.briefing.get(projectId, parsed && !Number.isNaN(parsed.getTime()) ? parsed : undefined);
  }
}
