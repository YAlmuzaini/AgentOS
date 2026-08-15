ALTER TABLE "goals" ADD COLUMN "progress_marks" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "dispatch_lease_token" text;