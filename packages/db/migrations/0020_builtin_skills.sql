-- Give skills the same provenance marker agents already carry.
--
-- `installBuiltInSkills` leaves every existing slug alone, deliberately: it
-- cannot tell a skill it wrote from one the operator wrote under the same name,
-- and "our built-in names probably do not collide" is not a safety boundary.
-- The cost of that showed up the moment migration 0019 added `description` and
-- `category` — the three skills that shipped before it stayed in `general` with
-- no description, and no re-install could fix them without also risking an
-- operator's text.
--
-- With this column the installer can do what the agent installer does: refresh
-- the metadata on rows it created, and leave everything else exactly as it is.
ALTER TABLE "skills" ADD COLUMN "built_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint

-- Claim only the rows that are, byte for byte, the text we shipped.
--
-- An earlier version of this matched on slug plus the empty description and
-- `general` category that migration 0019 had just given *every* existing row —
-- which is no evidence at all. An operator who wrote their own `plan-mode`
-- would have had it marked as ours, and every later install would then have
-- felt free to rewrite its metadata. Comparing the body is the only honest
-- test: it is the text the installer actually wrote, and any edit at all makes
-- the row theirs and leaves it alone.
UPDATE "skills" SET "built_in" = true
WHERE "description" = '' AND "category" = 'general' AND (
  ("slug" = 'plan-mode' AND "body" = 'Enter plan mode before writing anything.

Read the specification and every attachment first. Then produce an ordered
implementation plan: each step small enough to review, named files where you
know them, and the check that proves the step is done.

Do not implement. Do not re-open decisions the approved spec already made. If
the spec cannot be reached or contradicts itself, stop and inbox the human
rather than guessing — a plan built on a guess costs more to unpick than the
question costs to ask.')  OR
  ("slug" = 'e2e-first' AND "body" = 'Run the repository''s own end-to-end tests as part of implementing, not
after it.

Find the existing harness — do not introduce a framework the repository does
not already use. If there is none, say so in the task activity and cover the
change with whatever level of test the repository does have.

A step is not done because the code was written. It is done when the check you
named in the plan actually passes, and you have pasted the output.')  OR
  ("slug" = 'commit-discipline' AND "body" = 'Commit only what the task asked for.

One commit per coherent change, with a message that says why rather than what —
the diff already says what. Never commit a credential, a .env file, or a token,
even one that appears in a fixture. Never disable a failing test to make a
commit pass; a failing test is a finding, and it belongs in the inbox.

You have git-write only if your manifest says so. If it does not, write your
work to the agent filesystem instead and say where you put it.')
);
