CREATE TABLE "github_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"installation_id" text NOT NULL,
	"account_login" text DEFAULT '' NOT NULL,
	"account_type" text DEFAULT '' NOT NULL,
	"repository_selection" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN "github_installation_id" uuid;--> statement-breakpoint
ALTER TABLE "github_installations" ADD CONSTRAINT "github_installations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "github_installations_project_installation_key" ON "github_installations" USING btree ("project_id","installation_id");--> statement-breakpoint
ALTER TABLE "repos" ADD CONSTRAINT "repos_github_installation_id_github_installations_id_fk" FOREIGN KEY ("github_installation_id") REFERENCES "public"."github_installations"("id") ON DELETE set null ON UPDATE no action;