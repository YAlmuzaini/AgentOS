import type { HandoffDto } from "@agentos/shared";
import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from "@nestjs/common";
import { OperatorGuard } from "../auth/operator.guard";
import { HandoffsService } from "./handoffs.service";

/** Optional and validated: an unparseable id reached a `uuid` cast and came
 * back as a 500, which reads as a broken server rather than a bad request.
 * Exported so the rule can be asserted without an HTTP harness. */
export const HANDOFF_QUERY_UUID = new ParseUUIDPipe({ optional: true });

@Controller("projects/:projectId/handoffs")
@UseGuards(OperatorGuard)
export class HandoffsController {
  constructor(private readonly handoffs: HandoffsService) {}

  @Get()
  list(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Query("taskId", HANDOFF_QUERY_UUID) taskId?: string,
    @Query("goalId", HANDOFF_QUERY_UUID) goalId?: string,
  ): Promise<HandoffDto[]> {
    return this.handoffs.list(projectId, { taskId, goalId });
  }
}
