/**
 * Craft skills — the standards that apply to one kind of work.
 *
 * Same constraint as the process skills: the body is inlined into the system
 * prompt of every session that holds it, so each stays short and grantable.
 * Grant an agent the two or three that match its job, not all of them.
 */

import type { SkillSeed } from "./types";

export const CRAFT_SKILL_SEEDS: SkillSeed[] = [
  {
    slug: "security-review-checklist",
    name: "Security review checklist",
    category: "security",
    description:
      "The order to read a change in when looking for injection, authorisation gaps, and leaked credentials. Grant it to reviewers and to agents touching auth or input handling.",
    kind: "prompt",
    body: `Read a change for security in this order, and report rather than patch.

1. **Input.** What reaches this code from outside, and what happens when it is
   not what you expect. Injection into queries, shells, templates and paths.
2. **Authorisation.** Who is allowed to do this, and where that is checked.
   A check in the UI is not a check.
3. **Credentials.** Secrets in code, fixtures, logs, error messages or a URL.
   A credential whose scope grew is a finding even if nothing leaked.
4. **Failure.** When this path errors, does it open or close? Fail closed.

Rank by what is actually reachable. Give the file, the line, the input that
triggers it, and what the attacker gets. An empty report is a valid result and
you should say so plainly.`,
  },
  {
    slug: "schema-change-safety",
    name: "Schema change safety",
    category: "data",
    description:
      "Expand, backfill, migrate readers, migrate writers, contract — each a separate deploy, with the lock named. Grant it to any agent that can change a database schema.",
    kind: "prompt",
    body: `Assume the old code is still running while your migration lands, because it
is.

Never rename or drop in place. Expand first: add the new column or table.
Backfill in bounded batches. Move readers, then writers, then — in a later
deploy — contract by removing the old shape. Each of those is separately
deployable and separately revertible.

Name the lock every statement takes and how long it holds it on the largest
table this touches. An index built without the concurrent option, or a type
change that rewrites a table, is an outage with a migration file's name on it.

Write the rollback before you write the migration. If a step cannot be rolled
back, say so at the top of the task.`,
  },
  {
    slug: "accessible-interface",
    name: "Accessible interface",
    category: "frontend",
    description:
      "Semantics first, every state designed, keyboard and focus working, and real tap targets. Grant it to any agent writing interface code.",
    kind: "prompt",
    body: `An interface is not done when it renders.

Build every state: loading, empty, error, partial, and far-too-much-data. The
empty state says what puts something there.

Semantic elements first — a button is a \`button\` — and ARIA only where the
semantics genuinely run out. Everything reachable and operable by keyboard,
with focus visible at every stop and a sensible order. Nothing conveyed by
colour alone. Contrast that holds in both themes.

On touch, no control below a real tap target. Check a narrow width as well as
a wide one, and say which widths you checked — "responsive" without two
numbers is an assertion.`,
  },
  {
    slug: "design-system-discipline",
    name: "Design system discipline",
    category: "frontend",
    description:
      "Use the project's tokens and components; extend the system rather than inlining a one-off value. Grant it alongside any interface work.",
    kind: "prompt",
    body: `Work in the system, not in the screen.

Use the existing tokens for colour, spacing, radius and type. If you need a
value the system does not have, add it to the system and say why — an inline
hex or a magic pixel is a fork of the design that nobody will find again.

Reach for the existing component before writing a new one, and extend it
rather than copying it. Two components doing one job will drift.

Each colour role carries one meaning and keeps it. Reusing the hue that means
"waiting on you" for something that is merely a fact dilutes the one signal
the operator relies on. Where the repository has a design document, it
outranks your judgement, and you cite the rule you applied.`,
  },
  {
    slug: "container-hygiene",
    name: "Container hygiene",
    category: "devops",
    description:
      "Small images, cached dependency layers, no build tools or secrets in the runtime stage, non-root user. Grant it to agents editing Dockerfiles or deploy config.",
    kind: "prompt",
    body: `Build images that are small, cacheable, and boring.

Multi-stage: compile in one stage, copy only the artefact into a slim runtime
stage. Install dependencies in their own layer, before copying source, so a
code change does not invalidate the dependency cache.

Never bake a secret into an image or pass one as a build argument — both
persist in the layer history. Take credentials at runtime from the environment.

Run as a non-root user. Pin base images by digest or at least by minor
version; \`latest\` makes a build that worked yesterday fail today for reasons
nobody changed.`,
  },
  {
    slug: "documentation-lookup",
    name: "Documentation lookup",
    category: "research",
    description:
      "Check the versioned primary source before implementing against an SDK or API, using a granted documentation connection first. Grant it to agents that integrate third-party services.",
    kind: "prompt",
    body: `Do not implement against an API from memory.

Check the primary source before writing the call: the vendor's own reference,
the SDK's types, the changelog. If you were granted a documentation
connection, use it before the open web — it is versioned and the open web is
not.

Check the version. An answer that was right two majors ago is a wrong answer
delivered confidently, and it is the most common way an integration fails.

Where the documentation and the observed behaviour disagree, say so on the
task rather than picking one silently.`,
  },
  {
    slug: "evidence-first-research",
    name: "Evidence-first research",
    category: "research",
    description:
      "Separate what you verified from what you inferred, attach sources, and treat contradictions as findings. Grant it to research and analysis agents.",
    kind: "prompt",
    body: `Report claims with their evidence attached, and mark each as verified or
uncertain.

Prefer the primary source. A blog post is evidence that someone believed
something on the day they wrote it; a vendor's documentation is evidence about
the product; the code is evidence about the code. Check the date on every one.

Where two sources contradict each other, that is a finding — name both and say
which you would act on and why. Do not average them into a confident middle.

When the answer is not available, say so. A plausible answer with no source is
the most expensive thing you can hand back, because it will be believed.`,
  },
];
