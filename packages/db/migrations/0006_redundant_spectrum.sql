DROP INDEX "env_bindings_project_key_key";--> statement-breakpoint
ALTER TABLE "env_bindings" ADD COLUMN "environment_id" uuid;--> statement-breakpoint
ALTER TABLE "env_bindings" ADD CONSTRAINT "env_bindings_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "env_bindings_environment_key_key" ON "env_bindings" USING btree ("environment_id","key");