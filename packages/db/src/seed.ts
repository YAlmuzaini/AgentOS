import { BUILT_IN_TEMPLATES, FOUNDATIONAL_PROMPT, ROLE_SEEDS } from "@agentos/shared";
import { eq } from "drizzle-orm";
import { createDatabase, requireDatabaseUrl } from "./client";
import { agents, environments, projects, taskTemplates } from "./schema";

/**
 * Seeds one project with the ten roles SPEC §4 requires so the feature template
 * can run, plus a deny-by-default environment. Idempotent: re-running updates
 * prompts in place rather than duplicating agents.
 */
const PROJECT_SLUG = process.env.SEED_PROJECT_SLUG ?? "acme";
const PROJECT_NAME = process.env.SEED_PROJECT_NAME ?? "Acme";
const PLANNER_MODEL = "claude-opus-5";
const WORKER_MODEL = "claude-sonnet-5";

/** The only spawn paths that exist. Absent from this map means: spawns nobody. */
const COLLABORATION: Record<string, string[]> = {
  "review-coordinator": ["feasibility", "scope-guardian", "coherence", "plan-risk"],
};

const WORKER_ROLES = new Set([
  "customer-support",
  "linkedin-content",
  "senior-dev",
  "implementation-plan-executioner",
  "librarian",
  "default",
]);

async function main(): Promise<void> {
  const db = createDatabase({ url: requireDatabaseUrl(), max: 1 });

  const existing = await db.query.projects.findFirst({
    where: eq(projects.slug, PROJECT_SLUG),
  });

  const project =
    existing ??
    (
      await db
        .insert(projects)
        .values({ name: PROJECT_NAME, slug: PROJECT_SLUG })
        .returning()
    )[0]!;

  const existingEnv = await db.query.environments.findFirst({
    where: eq(environments.projectId, project.id),
  });
  if (!existingEnv) {
    await db.insert(environments).values([
      { projectId: project.id, name: "limited-none", networking: "limited", allowedHosts: [] },
      { projectId: project.id, name: "open", networking: "open", allowedHosts: [] },
    ]);
  }

  for (const role of ROLE_SEEDS) {
    const model = WORKER_ROLES.has(role.name) ? WORKER_MODEL : PLANNER_MODEL;
    await db
      .insert(agents)
      .values({
        projectId: project.id,
        // Marks provenance: the installer only refreshes rows it created.
        builtIn: true,
        name: role.name,
        title: role.title,
        model,
        foundationalPrompt: FOUNDATIONAL_PROMPT,
        rolePrompt: role.rolePrompt,
        // The coordinator is the only role that spawns anyone, and it may spawn
        // exactly the four plan reviewers (SPEC §5.10, §10 step 3).
        collaborationList: COLLABORATION[role.name] ?? [],
        // Inherit, so the project's own setting decides. Pinning these to
        // "cloud" meant every seeded agent billed the API no matter what the
        // operator chose, and nothing in the UI could change it.
        runnerPreference: "inherit",
        inboxAccess: true,
      })
      .onConflictDoUpdate({
        target: [agents.projectId, agents.name],
        // Only rows the seed itself created. Reconciling by name alone meant an
        // operator's own agent that happens to be called `plan` had its role
        // prompt — its behaviour — rewritten by a re-seed.
        setWhere: eq(agents.builtIn, true),
        set: {
          title: role.title,
          foundationalPrompt: FOUNDATIONAL_PROMPT,
          rolePrompt: role.rolePrompt,
          // `runnerPreference` and `collaborationList` are deliberately
          // absent. What this upsert reconciles is text *we* author — titles
          // and prompts — and re-seeding is how a built-in picks up an improved
          // one. Where an agent runs is the operator's money, and a
          // collaboration list is spawn authorisation, so re-seeding must not
          // quietly restore either.
          // Migration 0013 does the one-time correction for installs that were
          // seeded while the old hardcoded `cloud` default was in place.
          updatedAt: new Date(),
        },
      });
  }

  for (const template of BUILT_IN_TEMPLATES) {
    await db
      .insert(taskTemplates)
      .values({ ...template, projectId: project.id })
      .onConflictDoUpdate({
        target: [taskTemplates.projectId, taskTemplates.name],
        set: {
          description: template.description,
          variables: template.variables,
          steps: template.steps,
          updatedAt: new Date(),
        },
      });
  }

  console.log(
    `seeded project ${project.slug}: ${ROLE_SEEDS.length} agents, ${BUILT_IN_TEMPLATES.length} templates`,
  );
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
