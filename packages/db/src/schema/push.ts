import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Browser push endpoints for the inbox PWA (SPEC §12).
 *
 * There is one operator, so subscriptions are not scoped to a user — every
 * registered browser is theirs.
 */
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
