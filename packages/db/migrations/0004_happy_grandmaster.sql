CREATE TABLE "automations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"cron" text NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"agent_id" uuid,
	"task_template_id" uuid,
	"task_name" text DEFAULT '' NOT NULL,
	"task_body" text DEFAULT '' NOT NULL,
	"template_variables" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_fired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trigger_fires" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trigger_id" uuid NOT NULL,
	"accepted" boolean NOT NULL,
	"reason" text,
	"task_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "triggers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"agent_id" uuid NOT NULL,
	"job_prompt" text DEFAULT '' NOT NULL,
	"secret_salt" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_task_template_id_task_templates_id_fk" FOREIGN KEY ("task_template_id") REFERENCES "public"."task_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trigger_fires" ADD CONSTRAINT "trigger_fires_trigger_id_triggers_id_fk" FOREIGN KEY ("trigger_id") REFERENCES "public"."triggers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triggers" ADD CONSTRAINT "triggers_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triggers" ADD CONSTRAINT "triggers_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "automations_project_name_key" ON "automations" USING btree ("project_id","name");--> statement-breakpoint
CREATE INDEX "trigger_fires_trigger_idx" ON "trigger_fires" USING btree ("trigger_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "triggers_project_name_key" ON "triggers" USING btree ("project_id","name");