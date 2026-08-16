ALTER TABLE "sessions" ADD COLUMN "access" jsonb;--> statement-breakpoint
ALTER TABLE "inbox_messages" ADD COLUMN "questions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "inbox_messages" ADD COLUMN "answers" jsonb DEFAULT '[]'::jsonb NOT NULL;