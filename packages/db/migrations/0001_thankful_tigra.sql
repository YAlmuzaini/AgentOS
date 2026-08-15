CREATE TABLE "env_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"key" text NOT NULL,
	"secret_id" uuid NOT NULL,
	"allowed_hosts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_objects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"path" text NOT NULL,
	"bucket_key" text NOT NULL,
	"mime" text DEFAULT 'application/octet-stream' NOT NULL,
	"size" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"allowed_operations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"credential_secret_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"remote_url" text NOT NULL,
	"mount_path" text NOT NULL,
	"credential_secret_id" uuid,
	"default_branch" text DEFAULT 'main' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "secret_refs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"provider_ref" text NOT NULL,
	"purpose" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"kind" text DEFAULT 'prompt' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"file_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "env_bindings" ADD CONSTRAINT "env_bindings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "env_bindings" ADD CONSTRAINT "env_bindings_secret_id_secret_refs_id_fk" FOREIGN KEY ("secret_id") REFERENCES "public"."secret_refs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_objects" ADD CONSTRAINT "file_objects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_connections" ADD CONSTRAINT "mcp_connections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_connections" ADD CONSTRAINT "mcp_connections_credential_secret_id_secret_refs_id_fk" FOREIGN KEY ("credential_secret_id") REFERENCES "public"."secret_refs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repos" ADD CONSTRAINT "repos_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repos" ADD CONSTRAINT "repos_credential_secret_id_secret_refs_id_fk" FOREIGN KEY ("credential_secret_id") REFERENCES "public"."secret_refs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_refs" ADD CONSTRAINT "secret_refs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "env_bindings_project_key_key" ON "env_bindings" USING btree ("project_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "file_objects_project_path_key" ON "file_objects" USING btree ("project_id","path");--> statement-breakpoint
CREATE INDEX "file_objects_project_idx" ON "file_objects" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_connections_project_name_key" ON "mcp_connections" USING btree ("project_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "repos_project_name_key" ON "repos" USING btree ("project_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "secret_refs_project_name_key" ON "secret_refs" USING btree ("project_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "skills_project_slug_key" ON "skills" USING btree ("project_id","slug");