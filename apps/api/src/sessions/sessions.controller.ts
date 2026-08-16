import type { SessionDto, SessionSummaryDto, ToolCallLogEntry } from "@agentos/shared";
import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Sse,
  UseGuards,
} from "@nestjs/common";
import { concatMap, distinctUntilChanged, from, interval, map, type Observable, startWith } from "rxjs";
import { OperatorGuard } from "../auth/operator.guard";
import { SessionsService } from "./sessions.service";

@Controller("sessions")
@UseGuards(OperatorGuard)
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  /** Summaries only — the tool-call log is fetched per session, not per list. */
  @Get()
  list(@Query("projectId") projectId?: string): Promise<SessionSummaryDto[]> {
    return this.sessions.listSummaries(projectId);
  }

  /** Includes the persisted tool-call log, so finished runs replay. */
  @Get(":id")
  get(@Param("id", ParseUUIDPipe) id: string): Promise<SessionDto> {
    return this.sessions.get(id);
  }

  /**
   * Live session viewer (SPEC §13): tool calls as they happen.
   *
   * Polls the persisted log rather than tapping the runner's stream, so a
   * viewer that connects late still sees the whole run, and a viewer that
   * disconnects costs the run nothing.
   */
  @Sse(":id/live")
  live(@Param("id", ParseUUIDPipe) id: string): Observable<{ data: LiveFrame }> {
    return interval(1000).pipe(
      startWith(0),
      concatMap(() => from(this.sessions.get(id))),
      map((session) => ({
        status: session.status,
        entries: session.toolCallLog,
      })),
      distinctUntilChanged(
        (previous, next) =>
          previous.status === next.status && previous.entries.length === next.entries.length,
      ),
      map((frame) => ({ data: frame })),
    );
  }

  /**
   * `?force=true` deletes the record even when the runtime was never confirmed
   * released — for rows that cannot satisfy the guard, like sessions predating
   * the column. It is logged as a warning, because it discards the control
   * plane's only handle on a container it cannot prove is gone.
   */
  @Delete(":id")
  remove(
    @Param("id", ParseUUIDPipe) id: string,
    @Query("force") force?: string,
  ): Promise<void> {
    return this.sessions.remove(id, force === "true");
  }
}

interface LiveFrame {
  status: SessionDto["status"];
  entries: ToolCallLogEntry[];
}
