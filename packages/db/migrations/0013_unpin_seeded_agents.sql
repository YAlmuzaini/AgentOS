-- Release the built-in role agents from the cloud runner.
--
-- Every seeded agent was created with `runner_preference = 'cloud'`, which was
-- a hardcoded default rather than a choice anyone made. The effect was that the
-- new "where sessions run" setting had no power over them: an operator could
-- select the local worker, see the setting save, and still be billed for every
-- run against the Anthropic API — which is the exact expense the setting was
-- added to stop. Migration 0012 added the setting; without this one it governs
-- nothing on any installation that was seeded before it.
--
-- Scoped deliberately to the fourteen built-in role names, and only where the
-- value is still the old default. An agent an operator pinned to `cloud`
-- themselves is indistinguishable from one the seed pinned, so this cannot be
-- perfect — but these names are ours, `inherit` still routes to cloud whenever
-- the project setting says `cloud` or the local worker is unreachable, and the
-- per-agent pin remains available for anything that genuinely needs it.
UPDATE "agents"
SET "runner_preference" = 'inherit'
WHERE "runner_preference" = 'cloud'
  AND "name" IN (
    'default',
    'spec',
    'plan',
    'senior-dev',
    'implementation-plan-executioner',
    'review-coordinator',
    'feasibility',
    'scope-guardian',
    'coherence',
    'plan-risk',
    'customer-support',
    'diagnostic',
    'linkedin-content',
    'librarian'
  );
