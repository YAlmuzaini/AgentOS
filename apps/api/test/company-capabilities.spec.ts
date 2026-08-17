import {
  agents,
  environments,
  githubInstallations,
  handoffs,
  projectSettings,
  repos,
  preflightChecks,
  secretRefs,
  sessions,
  taskTemplates,
} from "@agentos/db";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CapabilityService } from "../src/capabilities/capability.service";
import { CompanyService } from "../src/company/company.service";
import { PreflightService } from "../src/capabilities/preflight.service";
import { BriefingService } from "../src/briefing/briefing.service";
import { HandoffsService } from "../src/handoffs/handoffs.service";
import { createHarness, type Harness } from "./harness";

describe("company profiles, capability cards, and handoffs", () => {
  let harness: Harness;
  let company: CompanyService;
  let capabilities: CapabilityService;
  let handoffService: HandoffsService;
  let preflight: PreflightService;
  let briefing: BriefingService;

  beforeAll(async () => {
    harness = await createHarness();
    company = harness.app.get(CompanyService);
    capabilities = harness.app.get(CapabilityService);
    handoffService = harness.app.get(HandoffsService);
    preflight = harness.app.get(PreflightService);
    briefing = harness.app.get(BriefingService);
  });
  afterAll(async () => harness.close());
  beforeEach(async () => harness.reset());

  /** A project with `minimal-core` applied and cloud execution, so the absent
   * local worker is not the finding under test. */
  async function blueprintProject(name: string, slug: string): Promise<string> {
    const [project] = await harness.db.execute<{ id: string }>(
      sql`INSERT INTO projects (name, slug) VALUES (${name}, ${slug}) RETURNING id`,
    );
    const projectId = project!.id;
    await company.apply(projectId, "minimal-core", { acknowledgeWarnings: true });
    await harness.db.update(projectSettings).set({ defaultRunner: "cloud" }).where(eq(projectSettings.projectId, projectId));
    return projectId;
  }

  /** Resolves the two required slots `minimal-core` declares. */
  async function resolveSlots(projectId: string): Promise<{
    repository: typeof repos.$inferSelect;
    environment: typeof environments.$inferSelect;
  }> {
    const [installation] = await harness.db.insert(githubInstallations).values({ projectId, installationId: "123" }).returning();
    const [repository] = await harness.db.insert(repos).values({ projectId, name: "primary", remoteUrl: "https://github.com/example/primary.git", mountPath: "/workspace/primary", githubInstallationId: installation!.id }).returning();
    const [environment] = await harness.db.insert(environments).values({ projectId, name: "open", networking: "open", allowedHosts: [] }).returning();
    await company.resolveSlot(projectId, "primary-repo", { resourceType: "repo", resourceId: repository!.id });
    await company.resolveSlot(projectId, "execution-environment", { resourceType: "environment", resourceId: environment!.id });
    return { repository: repository!, environment: environment! };
  }

  it("applies a blueprint idempotently without grants or overwriting customization", async () => {
    const [project] = await harness.db.execute<{ id: string }>(sql`INSERT INTO projects (name, slug) VALUES ('Company', 'company') RETURNING id`);
    const projectId = project!.id;
    const preview = await company.preview(projectId, "minimal-core");
    expect(preview.create.some((entry) => entry.startsWith("agent:"))).toBe(true);
    await company.apply(projectId, "minimal-core", { acknowledgeWarnings: true });
    const first = await company.slots(projectId);
    expect(first.some((slot) => slot.key === "primary-repo" && slot.resourceId === null)).toBe(true);

    const senior = await harness.db.query.agents.findFirst({ where: and(eq(agents.projectId, projectId), eq(agents.name, "senior-dev")) });
    await harness.db.update(agents).set({ rolePrompt: "operator-owned", repoAccess: [] }).where(eq(agents.id, senior!.id));
    await company.apply(projectId, "minimal-core", { acknowledgeWarnings: true });
    const after = await harness.db.query.agents.findFirst({ where: eq(agents.id, senior!.id) });
    expect(after!.rolePrompt).toBe("operator-owned");
    expect(after!.repoAccess).toEqual([]);
    expect(await company.slots(projectId)).toHaveLength(first.length);
  });

  /**
   * Two profiles can declare the same slot key. The rule: the first profile
   * owns the definition, a resolved resource is never repointed, and a later
   * profile's stricter `required` does propagate.
   */
  it("never silently overwrites a slot another profile already owns", async () => {
    const projectId = await blueprintProject("Two", "two");
    const { repository } = await resolveSlots(projectId);

    const preview = await company.preview(projectId, "full-stack-product");
    expect(preview.warnings.some((warning) => warning.includes('"primary-repo" already belongs to profile "minimal-core"'))).toBe(true);
    expect(preview.warnings.some((warning) => warning.includes("already-resolved resource is kept"))).toBe(true);

    await company.apply(projectId, "full-stack-product", { acknowledgeWarnings: true });

    const slots = await company.slots(projectId);
    const primary = slots.find((slot) => slot.key === "primary-repo")!;
    expect(primary.blueprintSlug).toBe("minimal-core");
    expect(primary.resourceId).toBe(repository.id);
    // The second profile's own new slots are still declared, unresolved.
    expect(slots.some((slot) => slot.key === "documentation" && slot.resourceId === null)).toBe(true);
  });

  it("keeps capability cards project scoped and serializes no credential values", async () => {
    const one = await harness.seedProject();
    await harness.db.execute(sql`INSERT INTO projects (name, slug) VALUES ('Other', 'other')`);
    await harness.db.insert(secretRefs).values({
      projectId: one.projectId,
      name: "repo-token",
      providerRef: "ULTRA_SECRET_PROVIDER_REFERENCE",
      purpose: "repo",
    });
    const cards = await capabilities.cards(one.projectId);
    expect(cards.some((card) => card.name === "senior-dev")).toBe(true);
    const serialized = JSON.stringify(cards);
    expect(serialized).not.toContain("providerRef");
    expect(serialized).not.toContain("credentialSecretId");
    expect(serialized).not.toContain("ULTRA_SECRET_PROVIDER_REFERENCE");
  });

  it("reports actionable blockers and rejects a cross-project slot resolution", async () => {
    // `minimal-core` declares `local`, and no worker is reachable in tests, so
    // the runner blocker is part of what this asserts. Left as the blueprint
    // set it rather than forced to cloud.
    const [project] = await harness.db.execute<{ id: string }>(sql`INSERT INTO projects (name, slug) VALUES ('Ready', 'ready') RETURNING id`);
    const projectId = project!.id;
    await company.apply(projectId, "minimal-core", { acknowledgeWarnings: true });

    const blocked = await preflight.run(projectId);
    expect(blocked.ready).toBe(false);
    expect(blocked.findings.map((entry) => entry.code)).toEqual(
      expect.arrayContaining(["resource-slot-unresolved", "local-runner-unavailable"]),
    );

    const [other] = await harness.db.execute<{ id: string }>(sql`INSERT INTO projects (name, slug) VALUES ('Elsewhere', 'elsewhere') RETURNING id`);
    const [foreignRepo] = await harness.db.insert(repos).values({ projectId: other!.id, name: "foreign", remoteUrl: "https://github.com/example/foreign.git", mountPath: "/workspace/foreign" }).returning();
    await expect(company.resolveSlot(projectId, "primary-repo", { resourceType: "repo", resourceId: foreignRepo!.id })).rejects.toThrow(/not found in this project/);
  });

  // The High-1 contract: a project is ready when a *capable subset* exists, not
  // when the whole roster has been handed every required resource. The previous
  // behaviour made a specialised fleet impossible — the support agent had to
  // hold the production repository before any goal could start.
  it("passes project preflight on a least-privilege fleet and names the gap when nobody is capable", async () => {
    const projectId = await blueprintProject("Least", "least");
    const { repository, environment } = await resolveSlots(projectId);

    const ungranted = await preflight.run(projectId);
    expect(ungranted.ready).toBe(false);
    expect(ungranted.findings.filter((entry) => entry.code === "no-capable-agent")).toHaveLength(2);
    expect(ungranted.findings.some((entry) => entry.code === "repo-not-granted")).toBe(false);

    // Exactly one agent is granted. Every other installed agent still holds
    // nothing, which is the point.
    const [senior] = await harness.db.select().from(agents).where(and(eq(agents.projectId, projectId), eq(agents.name, "senior-dev")));
    await harness.db.update(agents)
      .set({ repoAccess: [{ repoId: repository.id, permissions: "git-write" }], environmentId: environment.id })
      .where(eq(agents.id, senior!.id));

    const ready = await preflight.run(projectId);
    expect(ready.findings.filter((entry) => entry.severity === "error")).toEqual([]);
    expect(ready.ready).toBe(true);
    expect(ready.findings.some((entry) => entry.code === "least-privilege-fleet")).toBe(true);
    expect(JSON.stringify(ready)).not.toContain("ULTRA_SECRET_PROVIDER_REFERENCE");

    const fleet = await harness.db.select().from(agents).where(eq(agents.projectId, projectId));
    expect(fleet.filter((row) => row.repoAccess.length === 0).length).toBeGreaterThan(1);
  });

  // A template *does* name its execution graph, so every role in it must hold
  // the required resources itself — a capable stranger is not enough.
  it("checks a workflow against exactly the roles its steps dispatch to", async () => {
    const projectId = await blueprintProject("Graph", "graph");
    const { repository, environment } = await resolveSlots(projectId);
    const template = (await harness.db.select().from(taskTemplates).where(and(eq(taskTemplates.projectId, projectId), eq(taskTemplates.name, "compound-engineer-workflow"))))[0]!;
    const inputs = { branchName: "feat/x", feature: "a thing" };

    const stepRoles = [...new Set(template.steps.filter((step) => step.agentName !== "human").map((step) => step.agentName))];
    const grant = { repoAccess: [{ repoId: repository.id, permissions: "git-write" as const }], environmentId: environment.id };

    // Granting a role that is *not* in the graph proves a capable agent
    // elsewhere in the project does not satisfy the workflow.
    await harness.db.update(agents).set(grant).where(and(eq(agents.projectId, projectId), eq(agents.name, "verifier")));
    const stillBlocked = await preflight.run(projectId, "template", template.id, inputs);
    const gaps = stillBlocked.findings.filter((entry) => entry.code === "role-missing-capability");
    expect(gaps.length).toBe(stepRoles.length);
    expect(stillBlocked.ready).toBe(false);

    for (const role of stepRoles) {
      await harness.db.update(agents).set(grant).where(and(eq(agents.projectId, projectId), eq(agents.name, role)));
    }
    const ready = await preflight.run(projectId, "template", template.id, inputs);
    expect(ready.findings.filter((entry) => entry.severity === "error")).toEqual([]);
    expect(ready.ready).toBe(true);
  });

  // Preflight has to be useful for a project assembled straight from catalogue
  // installs and explicit grants, with no blueprint row anywhere.
  it("runs direct-grant preflight with no blueprint installed", async () => {
    const { projectId } = await harness.seedProject();
    const ready = await preflight.run(projectId);
    expect(ready.findings.some((entry) => entry.code === "no-blueprint")).toBe(true);
    expect(ready.ready).toBe(true);

    await harness.db.delete(agents).where(eq(agents.projectId, projectId));
    const empty = await preflight.run(projectId);
    expect(empty.ready).toBe(false);
    expect(empty.findings.some((entry) => entry.code === "eligible-roster-empty")).toBe(true);
  });

  /**
   * A *recommendation* is advice. The installer deliberately preserves a
   * removal — "remove one and it stays removed" — so treating the same removal
   * as a readiness failure made a documented, supported action the thing that
   * made the agent ineligible for every goal and blocked every workflow that
   * dispatches to it.
   */
  it("keeps an agent dispatchable after the operator removes a recommended skill", async () => {
    const projectId = await blueprintProject("Advice", "advice");
    const { repository, environment } = await resolveSlots(projectId);
    const grant = { repoAccess: [{ repoId: repository.id, permissions: "git-write" as const }], environmentId: environment.id };
    await harness.db.update(agents).set(grant).where(and(eq(agents.projectId, projectId), eq(agents.name, "senior-dev")));

    const before = (await capabilities.cards(projectId)).find((card) => card.name === "senior-dev")!;
    expect(before.ready).toBe(true);
    expect(before.advisories).toEqual([]);

    // The operator strips the recommended skills, on purpose.
    await harness.db.update(agents).set({ skillIds: [] }).where(and(eq(agents.projectId, projectId), eq(agents.name, "senior-dev")));

    const after = (await capabilities.cards(projectId)).find((card) => card.name === "senior-dev")!;
    expect(after.advisories.length).toBeGreaterThan(0);
    expect(after.reasons).toEqual([]);
    expect(after.ready).toBe(true);

    const { eligible } = await capabilities.roster(projectId, "cloud");
    expect(eligible.map((card) => card.name)).toContain("senior-dev");

    const report = await preflight.run(projectId);
    expect(report.ready).toBe(true);
    expect(report.findings.some((entry) => entry.severity === "error")).toBe(false);
  });

  /**
   * Preflight runs on a polled GET, so an unchanged failure must not write a
   * new audit row every time the screen refetches — the executive briefing maps
   * one row to one entry, and ten refocuses became ten identical "project
   * failed preflight" lines on the one screen meant to be read unattended.
   *
   * This is also the test that catches the way the first dedupe failed: it
   * compared `JSON.stringify` of a row that had been through `jsonb`, and
   * Postgres normalises object key order, so the comparison never matched.
   */
  it("records one row per distinct blocked preflight, however often it is polled", async () => {
    const projectId = await blueprintProject("Audit", "audit");

    for (let i = 0; i < 5; i += 1) await preflight.run(projectId);
    const first = await harness.db.select().from(preflightChecks).where(eq(preflightChecks.projectId, projectId));
    expect(first).toHaveLength(1);
    expect(first[0]!.ready).toBe("blocked");

    // A genuinely different failure gets its own row.
    const { repository } = await resolveSlots(projectId);
    expect(repository.id).toBeTruthy();
    await preflight.run(projectId);
    const second = await harness.db.select().from(preflightChecks).where(eq(preflightChecks.projectId, projectId));
    expect(second.length).toBeGreaterThan(1);
    const distinct = new Set(second.map((row) => JSON.stringify(row.findings.map((f) => f.code).sort())));
    expect(distinct.size).toBe(second.length);

    // And a passing check writes nothing at all.
    const before = second.length;
    await harness.db.update(agents)
      .set({ repoAccess: [{ repoId: repository.id, permissions: "git-write" }], environmentId: (await harness.db.query.environments.findFirst({ where: eq(environments.projectId, projectId) }))!.id })
      .where(and(eq(agents.projectId, projectId), eq(agents.name, "senior-dev")));
    const ready = await preflight.run(projectId);
    expect(ready.ready).toBe(true);
    expect(await harness.db.select().from(preflightChecks).where(eq(preflightChecks.projectId, projectId))).toHaveLength(before);
  });

  // The evaluator must never be offered an agent preflight would refuse.
  it("excludes an agent without the goal's required resources from the eligible roster", async () => {
    const projectId = await blueprintProject("Roster", "roster");
    const { repository, environment } = await resolveSlots(projectId);
    const [senior] = await harness.db.select().from(agents).where(and(eq(agents.projectId, projectId), eq(agents.name, "senior-dev")));
    await harness.db.update(agents)
      .set({ repoAccess: [{ repoId: repository.id, permissions: "git-write" }], environmentId: environment.id })
      .where(eq(agents.id, senior!.id));

    const { cards, eligible, required } = await capabilities.roster(projectId, "cloud");
    expect(required.repoIds).toEqual([repository.id]);
    expect(required.environmentIds).toEqual([environment.id]);
    expect(eligible.map((card) => card.name)).toEqual(["senior-dev"]);
    expect(cards.length).toBeGreaterThan(eligible.length);
    // Ready but incapable: the exclusion is about grants, not about health.
    expect(cards.filter((card) => card.ready).length).toBeGreaterThan(1);

    // A second project's requirements never reach this one.
    const other = await blueprintProject("Neighbour", "neighbour");
    const neighbour = await capabilities.roster(other, "cloud");
    expect(neighbour.required).toEqual({ repoIds: [], environmentIds: [], mcpIds: [] });
    expect(neighbour.eligible.some((card) => card.id === senior!.id)).toBe(false);
  });

  it("persists a scoped handoff and rejects an invented next collaborator", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    await harness.db.update(agents).set({ collaborationList: ["senior-dev"] }).where(eq(agents.id, agentIds.plan!));
    const [session] = await harness.db.insert(sessions).values({ projectId, agentId: agentIds.plan!, runner: "cloud" }).returning();

    await expect(handoffService.createForSession(session!.id, { outcome: "done", recommendedNextRole: "invented-role" })).rejects.toThrow(/authorised collaborator/);
    const saved = await handoffService.createForSession(session!.id, { outcome: "Plan verified", verification: ["typecheck passed"], recommendedNextRole: "senior-dev" });
    expect(saved.projectId).toBe(projectId);
    expect(saved.recommendedNextRole).toBe("senior-dev");
    expect((await harness.db.select().from(handoffs).where(eq(handoffs.projectId, projectId)))).toHaveLength(1);
  });

  it("briefs persisted preflight failures and distinguishes subscription from metered local work", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    await company.apply(projectId, "minimal-core", { acknowledgeWarnings: true });
    await preflight.run(projectId);
    await harness.db.insert(sessions).values([
      { projectId, agentId: agentIds.plan!, runner: "cloud", billingMode: "metered-api", costUsd: "1.2500", status: "destroyed" },
      { projectId, agentId: agentIds.plan!, runner: "local", billingMode: "subscription", status: "destroyed" },
      { projectId, agentId: agentIds.plan!, runner: "local", billingMode: "metered-api", costUsd: "0.5000", status: "destroyed" },
    ]);

    const report = await briefing.get(projectId);
    expect(report.failures.some((entry) => entry.title === "project failed preflight")).toBe(true);
    expect(report.execution).toMatchObject({
      cloudSessions: 1,
      cloudCostUsd: 1.25,
      localSessions: 2,
      localSubscriptionSessions: 1,
      localMeteredSessions: 1,
      localUnknownSessions: 0,
    });
  });
});
