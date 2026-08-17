import type { CreateTemplateInput } from "../contracts/template";
import { BUILT_IN_TEMPLATES } from "./compound-engineer";

/**
 * Every shape a built-in workflow has ever had.
 *
 * `task_templates.built_in` was added late (migration 0023). Rows written by
 * `installBuiltIns` before it exists default to `false`, so an unchanged
 * shipped workflow reads as operator-authored after an upgrade — and the
 * installer, which refuses to touch operator-authored rows, would then never
 * hand it a corrected step. The `compound-engineer-workflow` row is the case
 * that matters: it dispatched its *code* review to `review-coordinator`, whose
 * collaboration list holds the four **plan** lenses, so the step spawned
 * nobody and attached a report written from one model's own reading.
 *
 * Adoption is therefore by **exact content**, never by name. A row whose
 * description, variables and steps match one of the shapes below is a shipped
 * workflow nobody edited, and is safe to mark catalog-owned and refresh. A row
 * that differs anywhere — one changed word in one prompt — stays the
 * operator's, forever.
 *
 * A shape is frozen here the moment a built-in changes. Do not derive one from
 * the live catalogue: the point is that it records what the catalogue *used*
 * to say.
 */
export type TemplateShape = Pick<
  CreateTemplateInput,
  "name" | "description" | "variables" | "steps"
>;

/**
 * `compound-engineer-workflow` as shipped before the code-review step was
 * rewired to `code-review-coordinator`. Written out in full rather than
 * derived from the current template, so a later edit to the live catalogue
 * cannot silently redefine what "unchanged legacy row" means.
 */
const COMPOUND_ENGINEER_V1: TemplateShape = {
  name: "compound-engineer-workflow",
  description:
    "Fully managed feature build: spec (you approve) → plan → multi-agent plan review → " +
    "revise → implement with E2E → code review → fixes → wiki → you merge.",
  variables: ["branchName", "feature"],
  steps: [
    {
      name: "Write a spec",
      agentName: "spec",
      approvalGate: true,
      attachmentsFromPrevious: false,
      prompt:
        "Write a detailed specification for: {{feature}}\n\n" +
        "Attach the spec as a file. Inbox the operator when it is ready for review. " +
        "You cannot mark this task done — it is approval-gated.",
    },
    {
      name: "Plan",
      agentName: "plan",
      approvalGate: false,
      attachmentsFromPrevious: true,
      prompt:
        "Turn the approved specification into a concrete, ordered implementation plan for " +
        "branch {{branchName}}. Write the plan onto the task and attach it as a file. " +
        "Do not implement.",
    },
    {
      name: "Plan review",
      agentName: "review-coordinator",
      approvalGate: false,
      attachmentsFromPrevious: true,
      prompt:
        "Spawn the four plan reviewers — feasibility, scope-guardian, coherence, plan-risk — " +
        "each reviewing the attached plan through its own lens only. Consolidate their " +
        "reports into must-fix and should-fix. Attach the consolidated report. " +
        "Do not implement fixes yourself.",
    },
    {
      name: "Revise plan",
      agentName: "plan",
      approvalGate: false,
      attachmentsFromPrevious: true,
      prompt:
        "Take the plan and the consolidated review. Resolve every must-fix. Decide on each " +
        "should-fix and say why. Attach the revised plan.",
    },
    {
      name: "Implementation",
      agentName: "implementation-plan-executioner",
      approvalGate: false,
      attachmentsFromPrevious: true,
      prompt:
        "Implement the attached plan on branch {{branchName}}. Do not re-litigate the plan. " +
        "Run the repository's existing end-to-end tests as part of this work — if the repo " +
        "has an E2E suite, it must pass before you finish. Commit.",
    },
    {
      name: "Code review",
      agentName: "review-coordinator",
      approvalGate: false,
      attachmentsFromPrevious: true,
      prompt:
        "Review the implementation on branch {{branchName}}. Spawn the code-review " +
        "specialists. Consolidate into must-fix and should-fix, each with the file and line " +
        "it applies to. Attach the report.",
    },
    {
      name: "Apply review fixes",
      agentName: "senior-dev",
      approvalGate: false,
      attachmentsFromPrevious: true,
      prompt:
        "Apply every must-fix from the attached code review on branch {{branchName}}. " +
        "Re-run the tests, including E2E. Commit.",
    },
    {
      name: "Librarian",
      agentName: "librarian",
      approvalGate: false,
      attachmentsFromPrevious: true,
      prompt:
        "Update the internal wiki to reflect how the codebase actually works after this " +
        "change. Do not change product code.",
    },
    {
      name: "Human review of deployment / PR",
      agentName: "human",
      approvalGate: true,
      attachmentsFromPrevious: true,
      prompt:
        "Check out branch {{branchName}}, review the PR, and merge it. " +
        "Nothing else runs until you close this card.",
    },
  ],
};

/** Superseded shapes only. The current catalogue is added by {@link knownBuiltInShapes}. */
export const LEGACY_BUILT_IN_TEMPLATE_SHAPES: TemplateShape[] = [COMPOUND_ENGINEER_V1];

/**
 * Every shape of `name` that a catalogue install could have produced — the
 * current one included, because a row that already matches it is still an
 * unedited built-in whose ownership flag was simply never set.
 */
export function knownBuiltInShapes(name: string): TemplateShape[] {
  return [...BUILT_IN_TEMPLATES, ...LEGACY_BUILT_IN_TEMPLATE_SHAPES]
    .filter((shape) => shape.name === name)
    .map((shape) => ({
      name: shape.name,
      description: shape.description,
      variables: shape.variables,
      steps: shape.steps,
    }));
}

/**
 * Whether a stored row is byte-for-byte one of the shapes above.
 *
 * Step objects are compared field by field in a fixed order rather than by
 * `JSON.stringify` on the raw values: a row round-trips through `jsonb`, which
 * does not preserve key order, so serialising the stored object directly would
 * report a mismatch for a row that is in fact identical.
 */
export function matchesKnownBuiltInShape(row: TemplateShape): boolean {
  const candidate = canonical(row);
  return knownBuiltInShapes(row.name).some((shape) => canonical(shape) === candidate);
}

function canonical(shape: TemplateShape): string {
  return JSON.stringify({
    name: shape.name,
    description: shape.description,
    variables: [...shape.variables],
    steps: shape.steps.map((step) => [
      step.name,
      step.agentName,
      step.prompt,
      step.approvalGate,
      step.attachmentsFromPrevious,
    ]),
  });
}
