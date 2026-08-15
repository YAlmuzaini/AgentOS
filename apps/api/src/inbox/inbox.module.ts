import { Module } from "@nestjs/common";
import { SessionsModule } from "../sessions/sessions.module";
import { QueueModule } from "../queue/queue.module";
import { InboxController } from "./inbox.controller";
import { InboxService } from "./inbox.service";

@Module({
  imports: [SessionsModule, QueueModule],
  controllers: [InboxController],
  providers: [InboxService],
  exports: [InboxService],
})
export class InboxModule {}
