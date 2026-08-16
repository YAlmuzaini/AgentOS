import {
  INBOX_STATUSES,
  type InboxMessageDto,
  type InboxStatus,
  type ReplyInboxInput,
  replyInboxSchema,
} from "@agentos/shared";
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { OperatorGuard } from "../auth/operator.guard";
import { ZodBody } from "../common/zod-body.pipe";
import { InboxService } from "./inbox.service";

@Controller("inbox")
@UseGuards(OperatorGuard)
export class InboxController {
  constructor(private readonly inbox: InboxService) {}

  /**
   * The whole inbox, or one subject's thread.
   *
   * `goalId` is what makes a goal's conversation shared (SPEC §11): every
   * specialist that ever worked it wrote into the same thread, and the goal
   * screen shows that thread rather than the flat list.
   */
  @Get()
  list(
    @Query("status") status?: string,
    @Query("goalId") goalId?: string,
    @Query("taskId") taskId?: string,
    @Query("projectId") projectId?: string,
  ): Promise<InboxMessageDto[]> {
    if (status && !INBOX_STATUSES.includes(status as InboxStatus)) {
      throw new BadRequestException(`status must be one of ${INBOX_STATUSES.join(", ")}`);
    }
    if (goalId || taskId) {
      if (!projectId) {
        throw new BadRequestException("a thread query needs projectId");
      }
      return this.inbox.thread({ projectId, goalId, taskId });
    }
    return this.inbox.list(projectId, status as InboxStatus | undefined);
  }

  @Post(":id/reply")
  reply(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodBody(replyInboxSchema)) body: ReplyInboxInput,
  ): Promise<InboxMessageDto> {
    return this.inbox.reply(id, body);
  }
}
