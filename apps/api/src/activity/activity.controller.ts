import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from "@nestjs/common";
import { OperatorGuard } from "../auth/operator.guard";
import { type ActivityEntryDto, ActivityService } from "./activity.service";

@Controller("projects/:projectId/activity")
@UseGuards(OperatorGuard)
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get()
  recent(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Query("limit") limit?: string,
  ): Promise<ActivityEntryDto[]> {
    const parsed = Number(limit);
    return this.activity.recent(projectId, Number.isFinite(parsed) ? Math.min(parsed, 500) : 100);
  }
}
