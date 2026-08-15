ALTER TABLE "trigger_fires" ADD COLUMN "signature" text;--> statement-breakpoint
CREATE UNIQUE INDEX "trigger_fires_signature_key" ON "trigger_fires" USING btree ("trigger_id","signature");