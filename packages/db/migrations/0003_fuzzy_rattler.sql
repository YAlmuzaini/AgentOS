CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"spec" text NOT NULL,
	"definition_of_done" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dod_approved" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"stopped_reason" text,
	"spend_cap_usd" numeric(12, 4),
	"spend_usd" numeric(12, 4) DEFAULT '0' NOT NULL,
	"max_duration_minutes" integer,
	"stuck_threshold" integer DEFAULT 19 NOT NULL,
	"stuck_count" integer DEFAULT 0 NOT NULL,
	"iterations" integer DEFAULT 0 NOT NULL,
	"runner_preference" text DEFAULT 'auto' NOT NULL,
	"progress_log" text DEFAULT '' NOT NULL,
	"last_agent_name" text,
	"started_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "goals_project_status_idx" ON "goals" USING btree ("project_id","status");