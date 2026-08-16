ALTER TABLE "tasks" ADD COLUMN "parent_task_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "spawned_by_agent_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "spawned_by_session_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "spawn_depth" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_spawned_by_agent_id_agents_id_fk" FOREIGN KEY ("spawned_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_parent_idx" ON "tasks" USING btree ("parent_task_id");--> statement-breakpoint
CREATE INDEX "tasks_spawned_by_session_idx" ON "tasks" USING btree ("spawned_by_session_id");