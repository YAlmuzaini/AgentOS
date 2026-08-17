/**
 * Process skills — how an agent works, regardless of what it is working on.
 *
 * **A skill here is not a file in your repository.** It is text injected into
 * the session prompt: `session-prompt.ts` renders a `prompt` skill's body
 * inline, and for a `file` skill renders the path on the agent filesystem so
 * the agent reads it with the tools it already has. Nothing is written into a
 * granted repo, nothing appears in a commit, and there is nothing to gitignore.
 *
 * Because the body is always inlined, a skill costs its full length in every
 * session that holds it — unlike Anthropic's Agent Skills, where only the
 * description is loaded until the skill is triggered. So these are short on
 * purpose. A skill that wants to be three pages long should be a `file` skill
 * whose path the agent reads when it needs it.
 */

import type { SkillSeed } from "./types";

export const PROCESS_SKILL_SEEDS: SkillSeed[] = [
  {
    slug: "plan-mode",
    name: "Plan mode",
    category: "planning",
    description:
      "Read everything, then produce an ordered plan with a named check per step, and implement nothing. Grant it to any agent whose job ends at the plan.",
    kind: "prompt",
    // SPEC §17 names this one explicitly, and §8.2's plan agent is written
    // assuming it. Reconstructed, like every prompt in this repo.
    body: `Enter plan mode before writing anything.

Read the specification and every attachment first. Then produce an ordered
implementation plan: each step small enough to review, named files where you
know them, and the check that proves the step is done.

Do not implement. Do not re-open decisions the approved spec already made. If
the spec cannot be reached or contradicts itself, stop and inbox the human
rather than guessing — a plan built on a guess costs more to unpick than the
question costs to ask.`,
  },
  {
    slug: "e2e-first",
    name: "End-to-end first",
    category: "testing",
    description:
      "Run the repository's own end-to-end suite as part of implementing rather than after it. Grant it to any agent that writes code and finishes a task.",
    kind: "prompt",
    // SPEC §10: "99% of the time it works because E2E testing is implemented
    // inside the workflow." The implementation step is where that has to land.
    body: `Run the repository's own end-to-end tests as part of implementing, not
after it.

Find the existing harness — do not introduce a framework the repository does
not already use. If there is none, say so in the task activity and cover the
change with whatever level of test the repository does have.

A step is not done because the code was written. It is done when the check you
named in the plan actually passes, and you have pasted the output.`,
  },
  {
    slug: "commit-discipline",
    name: "Commit discipline",
    category: "engineering",
    description:
      "One coherent change per commit, a message that says why, and never a credential or a disabled test. Grant it to any agent with git-write.",
    kind: "prompt",
    body: `Commit only what the task asked for.

One commit per coherent change, with a message that says why rather than what —
the diff already says what. Never commit a credential, a .env file, or a token,
even one that appears in a fixture. Never disable a failing test to make a
commit pass; a failing test is a finding, and it belongs in the inbox.

You have git-write only if your manifest says so. If it does not, write your
work to the agent filesystem instead and say where you put it.`,
  },
  {
    slug: "no-fake-completion",
    name: "No fake completion",
    category: "general",
    description:
      "Treat placeholders, stubs, and skipped tests as blockers rather than progress, and report what was not done. Grant it to every agent that can mark a task finished.",
    kind: "prompt",
    body: `You may not report work as done that you did not do.

Before finishing, read back every file you changed and look for your own
shortcuts: a TODO left where the logic belongs, a function returning a
constant, a branch that throws "not implemented", a test marked skip or only,
a mock standing in for the thing under test, a config value hardcoded because
the real one was awkward to reach.

Each of those is a blocker, not progress. Either finish it or say explicitly,
on the task, which part you did not do and why. Scaling the work down is the
human's decision, so it goes in the inbox — quietly delivering less than was
asked is the one failure this system cannot see.`,
  },
  {
    slug: "verification-loop",
    name: "Verification loop",
    category: "testing",
    description:
      "Before finishing, run build, types, lint and tests in order and paste the real output for each. Grant it to any agent whose work has to be trusted without a human re-running it.",
    kind: "prompt",
    body: `Nothing is finished until it is verified, and a claim is not verification.

Run what the repository actually has, in this order, stopping to fix rather
than continuing past a failure: install, build, type check, lint, tests.
Take the commands from the repo's own scripts rather than inventing them.

Report each as passed, failed, or absent — absent is a result worth saying.
Paste the real output for anything that failed and the summary line for
anything that passed. If a check cannot run in this session, say which one and
why, so nobody reads its silence as a pass.`,
  },
  {
    slug: "root-cause-first",
    name: "Root cause first",
    category: "engineering",
    description:
      "Reproduce and isolate before editing, and hold competing hypotheses rather than the first plausible one. Grant it to agents that debug.",
    kind: "prompt",
    body: `Find the cause before you change anything.

Reproduce first: the smallest command that fails, with its exact output. If
you cannot reproduce it, say so — a fix for a failure you never saw is a
guess with a commit attached.

Hold at least two explanations at once and look for the evidence that would
rule one out, not the evidence that confirms your favourite. Say what you
eliminated and how.

Fix the cause, not the symptom. A retry, a widened timeout, a swallowed
exception, or a test loosened to pass are all ways of hiding the bug rather
than removing it, and each one is a finding you should report instead.`,
  },
  {
    slug: "search-first",
    name: "Search first",
    category: "research",
    description:
      "Look for the existing helper, pattern, or dependency in this repository before writing a new one. Grant it to implementation agents on a mature codebase.",
    kind: "prompt",
    body: `Before writing something new, find out whether it already exists here.

Search the repository for the behaviour by name, by call site, and by the
shape of the data — a helper is often named nothing like the thing you would
have called it. Read a neighbouring file that solves the adjacent problem and
follow the convention it establishes.

Reach for a new dependency last, and say why the existing ones do not cover
it. A second library doing what the first already does is a cost the whole
repository pays.

Where you do write something new, put it where a future search would find it.`,
  },
  {
    slug: "context-discipline",
    name: "Context discipline",
    category: "general",
    description:
      "Retrieve progressively — narrow searches before whole files — and summarise findings into the task rather than the transcript. Grant it to agents working in large repositories.",
    kind: "prompt",
    body: `Read narrowly and deliberately. A long session that read everything is worse
than a short one that read the right thing.

Locate before you load: search for the symbol, then read the region around it,
then widen only if the answer is not there. Read whole files when they are
small or when structure is the question, not by default.

When you learn something the next step will need — where a thing lives, what a
convention is, what you ruled out — write it onto the task or into your
folder. A finding that exists only in this session's transcript is lost the
moment the container is destroyed, and this container always is.`,
  },
  {
    slug: "pr-hygiene",
    name: "Change hygiene",
    category: "engineering",
    description:
      "Keep a change to one concern, leave unrelated improvements alone, and say what you deliberately did not touch. Grant it to any agent that commits.",
    kind: "prompt",
    body: `One change, one concern.

Do not fold an unrelated fix, a rename, or a reformat into the work you were
asked to do; each one makes the diff harder to review and the revert harder to
aim. When you notice something worth fixing that is not this task, write it on
the task as a note and leave the code alone.

Keep the diff readable: no reflowed lines you did not otherwise touch, no
reordered imports as a side effect, no dependency added for a single call.

Finish by saying, in one line, what this change does and what you deliberately
left alone.`,
  },
];
