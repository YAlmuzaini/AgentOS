# CLAUDE.md — Session Contract

Product: **AgentOS**. Single-operator control plane on Anthropic Managed Agents (cloud) and a
local VM worker behind the same `Runner` interface. Not a SaaS.

## Read on every boot

1. `RECIPE.md` — the engineering contract. Fixed. Follow unless the founder overrides.
2. `PRODUCT.md` — what we build, for whom, and the sanctioned RECIPE deviations.
3. `SPEC.md` — the product contract. Build this. Do not invent past it.
4. `PROGRESS.md` — living state: current phase, done, in-progress, open questions.
5. `DESIGN.md` — design system (Impeccable output, RECIPE §A4/§A6). It exists. UI changes
   conform to it; re-run the Impeccable critique on every UI change, not just the detector hook.

`DEPLOY.md` is shipping, not boot. Read it when the task is deploy, the local runner, or
GlitchTip — not otherwise.

## Rules for this project

- **User-gated commits.** Never commit or push without founder approval. Present the diff,
  summarize, stop.
- **oh-my-claudecode autopilot modes (ralph, ultrawork, ultraqa) are disabled for this
  project, permanently.** They run autonomously to completion and can self-commit — that
  conflicts with the rule above. Use `/oh-my-claudecode:plan` for scoping only. This is a
  standing rule, not something to re-confirm each session.
- **One session, one purpose.** All eight SPEC §21 phases are built. New work is still sliced
  (RECIPE §A5). Bundle related slices where reasonable, but keep commit gates between them
  inside the session. Bundling for budget reasons doesn't waive the gate.
- **Master-only.** No feature branches (RECIPE A1.5). Never touch git while a session is
  running. One session owns the tree.
- **Verify staged files before describing a diff.** Run `git status --short --branch` before
  presenting any diff. Don't describe a diff from memory of what you edited — confirm what's
  actually staged matches what you intended.
- **Never leave a process backgrounded with no visible output.** Run `pnpm --filter @agentos/api
  dev` (:3001) and `pnpm --filter @agentos/web dev` (:5173) in the foreground where the founder
  can watch them, or state explicitly in the handoff what's still running, on what port, and
  whether it needs a restart. `auto` routing prefers a live local runner; say so if one is up.
- **The test suite must never reach a live runner.** The harness blanks `LOCAL_RUNNER_URL` for
  a reason: a worker on this machine plus `auto` routing bills a real subscription. Do not
  un-blank it to "make tests more realistic."
- **Sacred-path verification needs a real runtime and the founder's own eyes — not
  FakeRunner, not green tests.** For this project the sacred paths are:
  - Isolation on a real container — network wall, vault lifecycle, session destroy. A
    support-style agent with no repo grant must not reach GitHub; a `limited` environment must
    403 at the runtime proxy, not in a stub. FakeRunner green is not this.
  - Approval gates — an agent session token `PATCH status=done` on a gated card is 403, every
    time, server-side. Honor-system in a prompt is a failure.
  - Goal spend — the number that matters is the Anthropic bill, not the session row. A cap the
    bill exceeds is a failure, not a stub.
  - Inbox pause/resume — same container, founder's answer, session continues. A stubbed
    `injectReply` is not this.
  - Operator UI — Inbox at 390px (Phone Rule, 44px targets, no horizontal scroll) and signal
    hues (One Meaning Rule: `live` / `gate` / `danger` each mean one thing). Founder's eyes,
    not an a11y score.
  - Live `compound-engineer-workflow` — spawn, attach, and record-commit used by a real model.
    Presence of the tools is not proof they get used.
- **`PROGRESS.md` is a changelog, not a journal.** Each session entry: 1–2 lines, what
  changed, what's now true, any new open gap. Rewrite "Where we are," don't append a narrative
  to it. Full narrative belongs in the commit message and the chat summary, not in this file.
- **Flag gaps loudly.** Stubs, failing tests, sold-but-unbuilt features, known-open local-runner
  credential exposure (`DEPLOY.md` §6) → surface, don't paper over, don't "fix" in userland.
- **Session lifecycle.** On boot: restate DONE / next slice / open items in 3–4 lines before
  building. On finish: update `PROGRESS.md` per the rule above, present the diff, STOP.

## Do not duplicate

`RECIPE.md` holds the engineering standard — governance, quality, stack, deploy, slicing.
`SPEC.md` holds the product — domain, isolation walls, session lifecycle, templates, goals,
acceptance tests. `PRODUCT.md` holds the five properties that *are* the product, and the
RECIPE deviations (Part B skipped; no Playwright in *this* repo; no billing). Read them
directly. Don't restate them here.
