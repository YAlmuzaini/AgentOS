import {
  blueprintInstallations,
  type Database,
  goals,
  projectSettings,
  preflightChecks,
  projectResourceSlots,
  projects,
  taskTemplates,
  repos,
  mcpConnections,
  environments,
} from "@agentos/db";
import {
  type CapabilityCard,
  isCapable,
  missingCapabilities,
  type PreflightFinding,
  type PreflightReport,
  type RequiredCapabilities,
} from "@agentos/shared";
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq, isNull } from "drizzle-orm";
import { DATABASE } from "../db/db.module";
import { RunnerRouter } from "../runner/runner-router";
import { CapabilityService } from "./capability.service";

/**
 * Proves an execution graph is ready before anything is dispatched.
 *
 * The load-bearing distinction is *who* must hold a required resource:
 *
 * - A **template** names the exact roles its steps dispatch to, so every one
 *   of those roles must hold the required resources. That is the graph.
 * - A **project or goal** has no fixed graph, so the question is whether a
 *   capable worker exists at all: at least one ready, eligible agent per
 *   required resource. An earlier revision applied the template rule to the
 *   whole roster, which meant a blueprint could not pass until every installed
 *   agent — the support agent included — held every required repository. That
 *   defeats the least-privilege fleet the product exists to build.
 *
 * The same resolved requirements feed the goal evaluator's eligible roster
 * (see `CapabilityService.roster`), so an agent preflight would not accept is
 * never offered to the orchestrator either.
 */
@Injectable()
export class PreflightService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly capabilities: CapabilityService,
    private readonly runners: RunnerRouter,
  ) {}

  async run(
    projectId: string,
    subjectType: "project" | "template" | "goal" = "project",
    subjectId: string | null = null,
    inputs: Record<string, string> = {},
  ): Promise<PreflightReport> {
    // Checked directly rather than through `ProjectsService`, which this module
    // does not import and does not otherwise need. Without the check an
    // unknown-but-well-formed project id built a whole report and then failed
    // on the audit insert's foreign key — a confusing way to say "no such
    // project".
    const project = await this.db.query.projects.findFirst({ where: eq(projects.id, projectId) });
    if (!project) throw new NotFoundException(`project ${projectId} not found`);
    const roster = await this.capabilities.cards(projectId);
    const findings: PreflightFinding[] = [];
    let runnerPreference: "cloud" | "local" | "auto";
    const requiredRoles = new Set<string>();
    const settings = await this.db.query.projectSettings.findFirst({
      where: eq(projectSettings.projectId, projectId),
    });

    if (subjectType === "template") {
      runnerPreference = (settings?.defaultRunner ?? "auto") as typeof runnerPreference;
      const template = subjectId
        ? await this.db.query.taskTemplates.findFirst({
            where: and(eq(taskTemplates.projectId, projectId), eq(taskTemplates.id, subjectId)),
          })
        : null;
      if (!template) throw new NotFoundException("template not found in this project");
      template.steps.filter((step) => step.agentName !== "human").forEach((step) => requiredRoles.add(step.agentName));
      for (const variable of template.variables.filter((name) => !inputs[name]?.trim())) {
        findings.push(finding("workflow-input-missing", "error", `Workflow input ${variable} is required.`, "template", template.id));
      }
      if (template.steps.some((step) => step.agentName === "human" || step.approvalGate)) {
        findings.push(finding("human-approval-explicit", "info", "This workflow contains an explicit operator approval step.", "template", template.id));
      }
    } else if (subjectType === "goal") {
      const goal = subjectId
        ? await this.db.query.goals.findFirst({
            where: and(eq(goals.projectId, projectId), eq(goals.id, subjectId)),
          })
        : null;
      if (!goal) throw new NotFoundException("goal not found in this project");
      runnerPreference = goal.runnerPreference as typeof runnerPreference;
    } else {
      runnerPreference = (settings?.defaultRunner ?? "auto") as typeof runnerPreference;
    }

    for (const role of requiredRoles) {
      const card = roster.find((candidate) => candidate.name === role);
      if (!card) {
        findings.push(finding("agent-missing", "error", `Required agent ${role} is not installed.`, "agent", role));
      } else if (!card.ready) {
        findings.push(finding("agent-not-ready", "error", `${role}: ${card.reasons.join("; ")}`, "agent", card.id));
      } else if (card.advisories.length > 0) {
        // Said, not enforced: the operator removed a recommended skill on
        // purpose and the installer honours that. Blocking on it would make a
        // supported action a dead end.
        findings.push(finding("agent-advisory", "info", `${role}: ${card.advisories.join("; ")}`, "agent", card.id));
      }
    }

    // Slots are processed whenever they exist, and direct grants are validated
    // whether or not a blueprint record exists. A project assembled straight
    // from catalog installs and explicit grants is a supported shape, and
    // preflight has to be useful for it.
    const installations = await this.db
      .select()
      .from(blueprintInstallations)
      .where(eq(blueprintInstallations.projectId, projectId));
    if (installations.length === 0) {
      findings.push(finding("no-blueprint", "info", "No company blueprint is installed; declared resources and direct grants were checked.", "project", projectId));
    }

    const slots = await this.db
      .select()
      .from(projectResourceSlots)
      .where(eq(projectResourceSlots.projectId, projectId));
    // Derived by the capability service, not re-derived here. Two copies of
    // "what does this project require" is exactly how preflight and the goal
    // evaluator disagreed in the first place; the slot walk below only
    // produces findings and human-readable labels.
    const required: RequiredCapabilities = await this.capabilities.requirements(projectId);
    const labels = new Map<string, string>();

    for (const slot of slots) {
      if (slot.definition.required && !slot.resourceId) {
        findings.push(finding("resource-slot-unresolved", "error", `${slot.definition.label} is required but unresolved.`, "slot", slot.id));
      } else if (!slot.resourceId) {
        findings.push(finding("optional-slot-unresolved", "warning", `${slot.definition.label} is optional and unresolved.`, "slot", slot.id));
      }
      if (!slot.resourceId || !slot.resourceType) continue;

      const resource = await this.resource(projectId, slot.resourceType, slot.resourceId);
      if (!resource) {
        findings.push(finding("resource-slot-stale", "error", `${slot.definition.label} points to a missing or cross-project resource.`, "slot", slot.id));
        continue;
      }
      if (slot.resourceType === "mcp" || slot.resourceType === "deployment") {
        const connection = resource as typeof mcpConnections.$inferSelect;
        if (!connection.verifiedAt) {
          findings.push(finding("mcp-unverified", "warning", `${connection.name} is configured but has not passed verification.`, "mcp", connection.id));
        }
      }
      // Only a *required* resolved slot names a capability, so only those get
      // a label to report the gap with.
      if (slot.definition.required) labels.set(slot.resourceId, slot.definition.label);
    }

    const localOnly = runnerPreference === "local";
    const runnable = (card: CapabilityCard): boolean =>
      !localOnly || card.runnerCompatibility.includes("local");

    if (requiredRoles.size > 0) {
      // The execution graph is known. Every role it dispatches to must hold
      // the required resources itself.
      for (const role of requiredRoles) {
        const card = roster.find((candidate) => candidate.name === role);
        if (!card) continue; // already reported as agent-missing
        const missing = missingCapabilities(card, required);
        const gaps = [
          ...missing.repoIds.map((id) => labels.get(id) ?? "a required repository"),
          ...missing.environmentIds.map((id) => labels.get(id) ?? "a required environment"),
          ...missing.mcpIds.map((id) => labels.get(id) ?? "a required connection"),
        ];
        if (gaps.length > 0) {
          findings.push(finding("role-missing-capability", "error", `${role} runs a step of this workflow but is not granted: ${gaps.join(", ")}.`, "agent", card.id));
        }
        if (card.ready && !runnable(card)) {
          findings.push(finding("agent-local-incompatible", "error", `${role} needs cloud-only enforcement or MCP filtering and cannot run under explicit local.`, "agent", card.id));
        }
      }
    } else {
      // No fixed graph: prove a capable worker exists for each requirement
      // rather than demanding the whole fleet hold it.
      const usable = roster.filter((card) => card.ready && runnable(card));
      for (const [kind, ids] of [
        ["repository", required.repoIds],
        ["environment", required.environmentIds],
        ["connection", required.mcpIds],
      ] as const) {
        for (const id of ids) {
          const single: RequiredCapabilities = {
            repoIds: kind === "repository" ? [id] : [],
            environmentIds: kind === "environment" ? [id] : [],
            mcpIds: kind === "connection" ? [id] : [],
          };
          if (!usable.some((card) => isCapable(card, single))) {
            findings.push(finding("no-capable-agent", "error", `No ready agent is granted ${labels.get(id) ?? `this required ${kind}`}${localOnly ? " and able to run under explicit local" : ""}.`, kind === "repository" ? "repo" : kind === "environment" ? "environment" : "mcp", id));
          }
        }
      }
      // Advisories belong on this path too. They were reported only for the
      // roles a *workflow* names, so on the project and goal screens — the two
      // an operator actually reads — a removed recommended skill was invisible.
      for (const card of usable.filter((candidate) => candidate.advisories.length > 0)) {
        findings.push(finding("agent-advisory", "info", `${card.name}: ${card.advisories.join("; ")}`, "agent", card.id));
      }
      // A fact, not a blocker: a specialised fleet is *expected* to contain
      // agents that hold nothing, and saying so as an error is what forced the
      // blanket grants this rewrite removes.
      const incapable = roster.filter((card) => card.ready && runnable(card) && !isCapable(card, required));
      if (incapable.length > 0 && (required.repoIds.length + required.environmentIds.length + required.mcpIds.length) > 0) {
        findings.push(finding("least-privilege-fleet", "info", `${incapable.length} ready agent(s) hold fewer than all required resources; they remain ineligible for work that needs them.`, "project", projectId));
      }
      if (localOnly) {
        const cloudOnly = roster.filter((card) => card.ready && !card.runnerCompatibility.includes("local"));
        if (cloudOnly.length > 0) {
          findings.push(finding("agent-local-incompatible", "warning", `These agents need cloud-only enforcement and are excluded under explicit local: ${cloudOnly.map((card) => card.name).join(", ")}.`, "runner", "local"));
        }
      }
    }

    const status = await this.runners.status();
    if (localOnly && !status.local.ready) {
      findings.push(finding("local-runner-unavailable", "error", "Explicit local execution requires a ready local worker; no cloud fallback is allowed.", "runner", "local"));
    }
    if (subjectType !== "template" && !roster.some((card) => card.ready && runnable(card) && isCapable(card, required))) {
      findings.push(finding("eligible-roster-empty", "error", subjectType === "goal" ? "No eligible agent can run this goal with the selected execution profile." : "No ready agent is eligible under this project's required resources and execution profile.", subjectType, subjectId ?? projectId));
    }

    const report: PreflightReport = {
      projectId,
      subjectType,
      subjectId,
      runnerPreference,
      ready: !findings.some((entry) => entry.severity === "error"),
      requiresAcknowledgement: findings.some((entry) => entry.severity === "warning"),
      findings,
      roster,
      checkedAt: new Date().toISOString(),
    };
    // Only a *blocked* check is persisted, and only when it says something new.
    //
    // Two constraints meet here. The executive briefing reads blocked checks
    // and nothing else, so recording the passes wrote an unbounded audit table
    // for a report nobody reads. But this method also runs on a *polled* GET —
    // the company-setup screen refetches on focus and after every mutation —
    // so writing every blocked result instead put ten identical "project failed
    // preflight" entries in the one screen meant to be read unattended.
    //
    // The dedupe is on the findings themselves: an unchanged failure updates
    // the timestamp of the row that already says it, and a genuinely different
    // failure gets its own row.
    if (!report.ready) {
      const latest = await this.db.query.preflightChecks.findFirst({
        where: and(
          eq(preflightChecks.projectId, projectId),
          eq(preflightChecks.subjectType, subjectType),
          subjectId ? eq(preflightChecks.subjectId, subjectId) : isNull(preflightChecks.subjectId),
        ),
        orderBy: desc(preflightChecks.checkedAt),
      });
      const same =
        latest !== undefined &&
        latest.ready === "blocked" &&
        canonicalFindings(latest.findings) === canonicalFindings(report.findings);
      if (same) {
        await this.db
          .update(preflightChecks)
          .set({ checkedAt: new Date(report.checkedAt) })
          .where(eq(preflightChecks.id, latest.id));
      } else {
        await this.db.insert(preflightChecks).values({
          projectId,
          subjectType,
          subjectId,
          runnerPreference,
          ready: "blocked",
          findings: report.findings,
          checkedAt: new Date(report.checkedAt),
        });
      }
    }
    return report;
  }

  async assertReady(
    projectId: string,
    type: "template" | "goal",
    id: string,
    acknowledgeWarnings = false,
    inputs: Record<string, string> = {},
  ): Promise<void> {
    const report = await this.run(projectId, type, id, inputs);
    if (!report.ready) {
      throw new BadRequestException({ message: "fleet preflight failed", report });
    }
    if (report.requiresAcknowledgement && !acknowledgeWarnings) {
      throw new BadRequestException({ message: "fleet preflight warnings require acknowledgement", report });
    }
  }

  private async resource(projectId: string, type: string, id: string): Promise<unknown | null> {
    if (type === "folder") return { path: id };
    const table = type === "repo" ? repos : type === "environment" ? environments : mcpConnections;
    return (await this.db.select().from(table).where(and(eq(table.projectId, projectId), eq(table.id, id))).limit(1))[0] ?? null;
  }
}

function finding(code: string, severity: "error" | "warning" | "info", message: string, subjectType: string, subjectId: string | null): PreflightFinding {
  return { code, severity, message, subjectType, subjectId, action: null };
}

/**
 * A stable string for "are these the same findings".
 *
 * Field order is fixed here rather than left to `JSON.stringify`, because one
 * side of the comparison has been through `jsonb` and Postgres normalises
 * object keys — shortest first, then bytewise — so a row read back is ordered
 * `code, action, message, severity, subjectId, subjectType` while a freshly
 * built finding is ordered `code, severity, message, …`. Comparing the raw
 * serialisations therefore never matched, and the dedupe this exists for was a
 * no-op that inserted on every poll.
 */
function canonicalFindings(findings: ReadonlyArray<Omit<PreflightFinding, "severity"> & { severity: string }>): string {
  return JSON.stringify(
    findings
      .map((entry) => [
        entry.code,
        entry.severity,
        entry.message,
        entry.subjectType,
        entry.subjectId,
        entry.action,
      ])
      // Sorted, because the findings array is built by walking rows from
      // queries with no ORDER BY. The *set* is what "same failure" means; heap
      // order is not, and an UPDATE that moves a tuple would otherwise make an
      // unchanged report look new.
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  );
}
