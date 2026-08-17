-- Give agents and skills a description and a category.
--
-- Both tables shipped with a name and a title and nothing else a reader could
-- sort by, which was fine at fourteen agents and three skills. It stops being
-- fine the moment the shipped catalogue is thirty-one roles and sixteen skills:
-- "who is responsible for this task" then means scrolling a flat list and
-- opening role prompts one at a time.
--
-- Both columns are NOT NULL with a default, so every existing row is valid the
-- moment this runs and no read path has to handle a null. An agent written
-- before this migration lands in `general` with an empty description — visible
-- and uncategorised, rather than absent from a filtered view.
--
-- `category` is text rather than a Postgres enum on purpose. The set is
-- authored in `packages/shared/src/catalog/categories.ts` and validated by Zod
-- at both doors (REST and `agentos push`); a pgEnum would add a migration to
-- every future category and buys nothing the application does not already
-- enforce.
ALTER TABLE "skills" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "category" text DEFAULT 'general' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "category" text DEFAULT 'general' NOT NULL;
