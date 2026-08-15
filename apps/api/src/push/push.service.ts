import { type Database, pushSubscriptions } from "@agentos/db";
import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { eq } from "drizzle-orm";
import webpush from "web-push";
import { APP_CONFIG, type AppConfig } from "../config/config";
import { DATABASE } from "../db/db.module";

export interface PushMessage {
  title: string;
  body: string;
  /** Path within the PWA to open when the notification is tapped. */
  url: string;
}

/**
 * Web Push for the inbox PWA (SPEC §12).
 *
 * Push is best-effort by design: a failed notification must never fail the
 * agent run that triggered it. Without VAPID keys the service is inert and
 * says so once, rather than throwing on every send.
 */
@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private enabled = false;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    if (!this.config.VAPID_PUBLIC_KEY || !this.config.VAPID_PRIVATE_KEY) {
      this.logger.warn("VAPID keys are not set — push notifications are disabled");
      return;
    }
    webpush.setVapidDetails(
      this.config.VAPID_SUBJECT,
      this.config.VAPID_PUBLIC_KEY,
      this.config.VAPID_PRIVATE_KEY,
    );
    this.enabled = true;
  }

  publicKey(): { publicKey: string; enabled: boolean } {
    return { publicKey: this.config.VAPID_PUBLIC_KEY, enabled: this.enabled };
  }

  async subscribe(input: {
    endpoint: string;
    p256dh: string;
    auth: string;
  }): Promise<{ ok: true }> {
    await this.db
      .insert(pushSubscriptions)
      .values(input)
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { p256dh: input.p256dh, auth: input.auth },
      });
    return { ok: true };
  }

  async send(message: PushMessage): Promise<void> {
    if (!this.enabled) {
      return;
    }
    const subscriptions = await this.db.select().from(pushSubscriptions);
    await Promise.all(
      subscriptions.map(async (subscription) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: { p256dh: subscription.p256dh, auth: subscription.auth },
            },
            JSON.stringify(message),
          );
        } catch (error) {
          // A gone subscription is normal — the browser was uninstalled or the
          // permission revoked. Drop it rather than retrying forever.
          const status = (error as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            await this.db
              .delete(pushSubscriptions)
              .where(eq(pushSubscriptions.endpoint, subscription.endpoint));
            return;
          }
          this.logger.warn(`push failed: ${String(error)}`);
        }
      }),
    );
  }
}
