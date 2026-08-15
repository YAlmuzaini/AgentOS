import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { OperatorGuard } from "../auth/operator.guard";
import { ZodBody } from "../common/zod-body.pipe";
import { PushService } from "./push.service";

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});
type SubscribeInput = z.infer<typeof subscribeSchema>;

@Controller("push")
@UseGuards(OperatorGuard)
export class PushController {
  constructor(private readonly push: PushService) {}

  /** The PWA needs this before it can subscribe. */
  @Get("public-key")
  publicKey(): { publicKey: string; enabled: boolean } {
    return this.push.publicKey();
  }

  @Post("subscribe")
  subscribe(@Body(new ZodBody(subscribeSchema)) body: SubscribeInput): Promise<{ ok: true }> {
    return this.push.subscribe({
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
    });
  }
}
