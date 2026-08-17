import { builtInRoleInstalls, BUILT_IN_SKILLS, BUILT_IN_TEMPLATES } from "@agentos/shared";
import { eq } from "drizzle-orm";
import { createDatabase, requireDatabaseUrl } from "./client";
import { agents, environments, projects, skills, taskTemplates } from "./schema";

/**
 * Seeds one project with the whole shipped role catalogue — the fourteen roles
 * SPEC §4 requires so the feature template can run, plus the specialists — and
 * a deny-by-default environment. Idempotent: re-running updates the text we
 * author in place rather than duplicating agents.
 *
 * The role list, the model tiers and the collaboration lists all come from
 * `builtInRoleInstalls()`, which is the same function the "install built-ins"
 * endpoint calls. They were duplicated here once and drifted the first time a
 * prompt improved.
 */
const PROJECT_SLUG = process.env.SEED_PROJECT_SLUG ?? "acme";
const PROJECT_NAME = process.env.SEED_PROJECT_NAME ?? "Acme";

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

  // Skills before agents, and in that order for a reason: a role's recommended
  // skills are resolved by slug, so seeding agents first produced a project
  // where every shipped skill existed and no agent held one — which is what an
  // operator opening a fresh install actually found.
  for (const skill of BUILT_IN_SKILLS) {
    await db
      .insert(skills)
      .values({ ...skill, projectId: project.id, filePath: null, builtIn: true })
      .onConflictDoUpdate({
        target: [skills.projectId, skills.slug],
        // Metadata only. The body is the operator's to edit, exactly as the
        // installer treats it.
        set: { description: skill.description, category: skill.category, updatedAt: new Date() },
        setWhere: eq(skills.builtIn, true),
      });
  }
  const skillIdBySlug = new Map(
    (
      await db
        .select({ id: skills.id, slug: skills.slug })
        .from(skills)
        .where(eq(skills.projectId, project.id))
    ).map((row) => [row.slug, row.id]),
  );

  const existingAgents = new Set(
    (
      await db.select({ name: agents.name }).from(agents).where(eq(agents.projectId, project.id))
    ).map((row) => row.name),
  );

  const roles = builtInRoleInstalls();
  for (const role of roles) {
    // Recommendations apply to a new agent only — re-seeding must not restore a
    // skill the operator deliberately removed.
    const recommended = existingAgents.has(role.name)
      ? []
      : role.recommendedSkills.flatMap((slug) => {
          const id = skillIdBySlug.get(slug);
          return id ? [id] : [];
        });
    await db
      .insert(agents)
      .values({
        ...role,
        projectId: project.id,
        // Marks provenance: the installer only refreshes rows it created.
        builtIn: true,
        skillIds: recommended,
      })
      .onConflictDoUpdate({
        target: [agents.projectId, agents.name],
        // Only rows the seed itself created. Reconciling by name alone meant an
        // operator's own agent that happens to be called `plan` had its role
        // prompt — its behaviour — rewritten by a re-seed.
        setWhere: eq(agents.builtIn, true),
        set: {
          title: role.title,
          description: role.description,
          category: role.category,
          foundationalPrompt: role.foundationalPrompt,
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
    `seeded project ${project.slug}: ${roles.length} agents, ${BUILT_IN_SKILLS.length} skills, ` +
      `${BUILT_IN_TEMPLATES.length} templates`,
  );
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
