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

  @Get()
  list(@Query("status") status?: string): Promise<InboxMessageDto[]> {
    if (status && !INBOX_STATUSES.includes(status as InboxStatus)) {
      throw new BadRequestException(`status must be one of ${INBOX_STATUSES.join(", ")}`);
    }
    return this.inbox.list(status as InboxStatus | undefined);
  }

  @Post(":id/reply")
  reply(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodBody(replyInboxSchema)) body: ReplyInboxInput,
  ): Promise<InboxMessageDto> {
    return this.inbox.reply(id, body);
  }
}
