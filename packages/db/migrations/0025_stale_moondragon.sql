CREATE TABLE "preflight_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid,
	"runner_preference" text NOT NULL,
	"ready" text NOT NULL,
	"findings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "billing_mode" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "preflight_checks" ADD CONSTRAINT "preflight_checks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "preflight_checks_project_checked_idx" ON "preflight_checks" USING btree ("project_id","checked_at");