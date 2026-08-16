/**
 * Skills that ship with AgentOS (SPEC §4 Skill, §8, §17).
 *
 * **A skill here is not a file in your repository.** It is text injected into
 * the session prompt — `session-prompt.ts` renders a `prompt` skill's body
 * inline, and for a `file` skill renders the path on the agent filesystem so
 * the agent reads it with the tools it already has. Nothing is written into a
 * granted repo, nothing appears in a commit, and there is nothing to gitignore.
 *
 * That also settles duplication: a skill is unique per project by slug, so
 * installing twice updates rather than doubles, and a skill you already keep in
 * a repository is a different thing living in a different place. If you want an
 * existing skill's text used here, paste it in as a `prompt` skill or write the
 * file to the agent filesystem and reference its path.
 *
 * The catalogue is small on purpose: these are the ones the built-in agents and
 * templates actually reference. Anything else is one form away on the Skills
 * page.
 */
export interface SkillSeed {
  slug: string;
  name: string;
  kind: "prompt" | "file";
  body: string;
}

export const BUILT_IN_SKILLS: SkillSeed[] = [
  {
    slug: "plan-mode",
    name: "Plan mode",
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
    kind: "prompt",
    body: `Commit only what the task asked for.

One commit per coherent change, with a message that says why rather than what —
the diff already says what. Never commit a credential, a .env file, or a token,
even one that appears in a fixture. Never disable a failing test to make a
commit pass; a failing test is a finding, and it belongs in the inbox.

You have git-write only if your manifest says so. If it does not, write your
work to the agent filesystem instead and say where you put it.`,
  },
];
