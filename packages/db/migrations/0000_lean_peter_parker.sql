CREATE TYPE "public"."assignee_type" AS ENUM('agent', 'human');--> statement-breakpoint
CREATE TYPE "public"."inbox_kind" AS ENUM('text', 'multiple-choice');--> statement-breakpoint
CREATE TYPE "public"."inbox_sender" AS ENUM('agent', 'human');--> statement-breakpoint
CREATE TYPE "public"."inbox_status" AS ENUM('open', 'answered', 'closed');--> statement-breakpoint
CREATE TYPE "public"."networking_mode" AS ENUM('open', 'limited');--> statement-breakpoint
CREATE TYPE "public"."runner" AS ENUM('cloud', 'local');--> statement-breakpoint
CREATE TYPE "public"."runner_preference" AS ENUM('cloud', 'local', 'inherit');--> statement-breakpoint
CREATE TYPE "public"."schedule_kind" AS ENUM('now', 'at', 'cron');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('starting', 'running', 'waiting-inbox', 'committing', 'destroyed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('todo', 'doing', 'review', 'done');--> statement-breakpoint
CREATE TABLE "environments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"networking" "networking_mode" DEFAULT 'limited' NOT NULL,
	"allowed_hosts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"runtime_environment_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"yaml" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"title" text NOT NULL,
	"model" text NOT NULL,
	"foundational_prompt" text NOT NULL,
	"role_prompt" text NOT NULL,
	"skill_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mcp_connection_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"repo_access" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"filesystem_grants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"collaboration_list" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"environment_id" uuid,
	"runner_preference" "runner_preference" DEFAULT 'inherit' NOT NULL,
	"inbox_access" boolean DEFAULT true NOT NULL,
	"runtime_agent_id" text,
	"runtime_agent_version" text,
	"runtime_config_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"session_id" uuid,
	"agent_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" "task_status" DEFAULT 'todo' NOT NULL,
	"assignee_type" "assignee_type" DEFAULT 'agent' NOT NULL,
	"assignee_agent_id" uuid,
	"attachment_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"approval_gate" boolean DEFAULT false NOT NULL,
	"chain_id" uuid,
	"chain_index" integer,
	"template_id" uuid,
	"schedule_kind" "schedule_kind" DEFAULT 'now' NOT NULL,
	"run_at" timestamp with time zone,
	"cron" text,
	"timezone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"task_id" uuid,
	"goal_id" uuid,
	"runner" "runner" DEFAULT 'cloud' NOT NULL,
	"status" "session_status" DEFAULT 'starting' NOT NULL,
	"runtime_handle" text,
	"trace_url" text,
	"tool_call_log" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"commit_shas" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cost_usd" numeric(12, 4),
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "inbox_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"from" "inbox_sender" NOT NULL,
	"agent_id" uuid,
	"session_id" uuid,
	"task_id" uuid,
	"goal_id" uuid,
	"kind" "inbox_kind" DEFAULT 'text' NOT NULL,
	"body" text NOT NULL,
	"choices" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"selected_choice_id" text,
	"status" "inbox_status" DEFAULT 'open' NOT NULL,
	"runtime_tool_use_id" text,
	"runtime_thread_id" text,
	"answered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "environments" ADD CONSTRAINT "environments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_activity" ADD CONSTRAINT "task_activity_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_activity" ADD CONSTRAINT "task_activity_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_agent_id_agents_id_fk" FOREIGN KEY ("assignee_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_messages" ADD CONSTRAINT "inbox_messages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_messages" ADD CONSTRAINT "inbox_messages_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_messages" ADD CONSTRAINT "inbox_messages_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_messages" ADD CONSTRAINT "inbox_messages_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "environments_project_name_key" ON "environments" USING btree ("project_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_slug_key" ON "projects" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "agents_project_name_key" ON "agents" USING btree ("project_id","name");--> statement-breakpoint
CREATE INDEX "task_activity_task_idx" ON "task_activity" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "tasks_project_status_idx" ON "tasks" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "tasks_chain_idx" ON "tasks" USING btree ("chain_id","chain_index");--> statement-breakpoint
CREATE INDEX "sessions_project_started_idx" ON "sessions" USING btree ("project_id","started_at");--> statement-breakpoint
CREATE INDEX "sessions_task_idx" ON "sessions" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "inbox_project_status_idx" ON "inbox_messages" USING btree ("project_id","status","created_at");--> statement-breakpoint
CREATE INDEX "inbox_session_idx" ON "inbox_messages" USING btree ("session_id");