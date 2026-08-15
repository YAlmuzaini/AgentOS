// Reconstructed from Danny Postma's AgentOS talk — not his verbatim template.
//
// The built-in feature workflow (SPEC §10). He described it as a ~3-hour
// managed feature build; observed runs were 5–6 hours. It works because E2E
// testing happens inside the workflow, so step 5 and the bug-fix chain both
// require it.

import type { CreateTemplateInput } from "../contracts/template";

export const COMPOUND_ENGINEER_TEMPLATE: CreateTemplateInput = {
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

/**
 * The post-bug-report fix chain (SPEC §10, §14). Same agents, no second
 * product — a diagnosis the operator approved becomes work.
 */
export const BUGFIX_TEMPLATE: CreateTemplateInput = {
  name: "bugfix-workflow",
  description: "Approved bug report → plan → plan review → fix → E2E → you merge.",
  variables: ["branchName", "bug"],
  steps: [
    {
      name: "Plan the fix",
      agentName: "plan",
      approvalGate: false,
      attachmentsFromPrevious: true,
      prompt:
        "Read the attached cause report for: {{bug}}\n\n" +
        "Write an ordered plan for the fix on branch {{branchName}}.",
    },
    {
      name: "Plan review",
      agentName: "review-coordinator",
      approvalGate: false,
      attachmentsFromPrevious: true,
      prompt: "Review the fix plan through the four lenses. Consolidate must-fix / should-fix.",
    },
    {
      name: "Fix",
      agentName: "senior-dev",
      approvalGate: false,
      attachmentsFromPrevious: true,
      prompt:
        "Apply the reviewed plan on branch {{branchName}}. Add a regression test that fails " +
        "without the fix. Commit.",
    },
    {
      name: "E2E test",
      agentName: "senior-dev",
      approvalGate: false,
      attachmentsFromPrevious: true,
      prompt:
        "Run the repository's end-to-end suite against branch {{branchName}} and report the " +
        "result on the task. If it fails, fix and re-run.",
    },
    {
      name: "Human review of deployment / PR",
      agentName: "human",
      approvalGate: true,
      attachmentsFromPrevious: true,
      prompt: "Review and merge branch {{branchName}}.",
    },
  ],
};

export const BUILT_IN_TEMPLATES = [COMPOUND_ENGINEER_TEMPLATE, BUGFIX_TEMPLATE];
