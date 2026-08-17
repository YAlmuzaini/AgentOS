CREATE TABLE "blueprint_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"blueprint_slug" text NOT NULL,
	"version" text NOT NULL,
	"provenance" jsonb NOT NULL,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goal_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"backend" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"eligible_agents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"selected_agents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"input_hash" text NOT NULL,
	"duration_ms" integer NOT NULL,
	"status" text DEFAULT 'success' NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "handoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid,
	"goal_id" uuid,
	"session_id" uuid NOT NULL,
	"from_agent_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_resource_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"blueprint_slug" text NOT NULL,
	"slot_key" text NOT NULL,
	"definition" jsonb NOT NULL,
	"resource_type" text,
	"resource_id" text,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "mcp_connections" ADD COLUMN "provenance" jsonb DEFAULT '{"relationship":"original"}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "provenance" jsonb DEFAULT '{"relationship":"original"}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "provenance" jsonb DEFAULT '{"relationship":"original"}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "recommended_skills_initialized" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "task_templates" ADD COLUMN "built_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "task_templates" ADD COLUMN "provenance" jsonb DEFAULT '{"relationship":"original"}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "blueprint_installations" ADD CONSTRAINT "blueprint_installations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_decisions" ADD CONSTRAINT "goal_decisions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_decisions" ADD CONSTRAINT "goal_decisions_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_from_agent_id_agents_id_fk" FOREIGN KEY ("from_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_resource_slots" ADD CONSTRAINT "project_resource_slots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "blueprint_installations_project_slug_key" ON "blueprint_installations" USING btree ("project_id","blueprint_slug");--> statement-breakpoint
CREATE INDEX "goal_decisions_goal_created_idx" ON "goal_decisions" USING btree ("goal_id","created_at");--> statement-breakpoint
CREATE INDEX "handoffs_project_created_idx" ON "handoffs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "handoffs_task_idx" ON "handoffs" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "handoffs_goal_idx" ON "handoffs" USING btree ("goal_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "project_resource_slots_project_key" ON "project_resource_slots" USING btree ("project_id","slot_key");