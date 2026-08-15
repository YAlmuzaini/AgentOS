CREATE TABLE "project_settings" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"parked_session_timeout_minutes" integer DEFAULT 1440 NOT NULL,
	"orphan_sweep_enabled" boolean DEFAULT true NOT NULL,
	"orphan_sweep_interval_minutes" integer DEFAULT 15 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "parked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "project_settings" ADD CONSTRAINT "project_settings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;