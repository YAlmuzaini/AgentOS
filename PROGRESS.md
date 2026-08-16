# PROGRESS.md — living state

Update every session. Read on boot alongside `RECIPE.md`, `PRODUCT.md`, `SPEC.md`, `DESIGN.md`.

**Last updated:** 2026-08-16

---

## What the operator could not see

The founder opened the app and found three things missing that no test would ever catch, because
each of them is an absence rather than a failure.

**Nothing showed a clock.** Not the inbox, not sessions, not the board. A message said "waiting on
you" without saying since when; a session listed tool calls with no idea whether the run was this
morning or on Tuesday. There is now one `Time` component — relative on the surface, exact stamp on
hover, machine font only for the exact form — and a `Duration` that ticks while a session is still
running, because a frozen 3m on a live run answers "is this stuck?" wrongly. It is on the inbox
(sent and answered), the session list and detail (started, ended, took), the board cards, the goal
rails (started, running for, last change), the task sheet, the file browser, and every activity row.

**The inbox said nothing about where a question came from.** No agent, no card, no session. At
23:00 that is a question from nobody about nothing, and answering it meant opening two other
screens first. Messages now carry the agent's name, the task or goal they belong to as a link, and
the session as a link — resolved server-side in three batched lookups, because the inbox polls.

**An agent could only ask one thing at a time.** `inbox_ask` took one question, so an agent needing
three decisions parked three times — three containers held open across three round trips through a
human who is not at their desk. A message now carries **up to four questions**, each with 2-4
choices and optionally its own free-text answer, and the operator answers all of them in one
submit. The reply is refused unless every question is answered: an agent told two of three proceeds
on a guess about the third. Single-question asks are untouched — the old shape still works, still
renders, and still answers with the bare label rather than a Q/A pair.

The design pass on these surfaces found five real breaches of `DESIGN.md`, all now fixed: three
open questions rendered three near-black buttons on one screen (the rule is one primary action, and
three equal ones are not one); amber `gate` was used for "unrestricted network", which is a fact
rather than something waiting on the human, and dilutes the hue the approval gate depends on;
emerald `live` marked a tool as *ever called* on a finished session, where everywhere else in the
app it means running right now; a choice button dimmed itself with opacity instead of changing
surface; and a status was encoded into the `PanelTitle` accent, which the component documents as
decoration only. The inbox's subject links also got real tap targets, since that is the one screen
held to 44px.

**Sessions never showed what the agent could touch.** Only what it did. `sessions.access` is now
recorded at provision from the same resolved grants the container gets — model, tools, MCP servers,
repos and their permissions, environment variable **keys**, folders, collaborators, network policy
— and the session screen shows it beside a count of how many times each tool was actually called.
Names and keys only: the panel is designed to be safe to look at.

## The inbox was a feed, and the file browser had no names

Two more from the founder looking at the running app.

**Every folder in the file browser rendered with no name.** A real bug, not a taste question: the
API returns folders with a trailing slash (`/agents/`), and the browser took the last segment of a
split — which after a trailing slash is the empty string. So the page was a column of folder icons
with nothing beside them, and the operator could not tell whether the disk was empty or broken.
There is one `entryName` now, used by the list and the download filename both. While there: the
path in the header is a breadcrumb rather than a label, folders carry a file count (a folder holding
nothing looked identical to one holding forty), and the empty state says what puts something there
— `/agents/<name>/` appears the first time an agent writes.

**The inbox was a stack of full cards.** With three open questions the third was below the fold, and
answering the first moved everything under the cursor. It is a queue and a reading pane now: rows
grouped "Waiting on you" then "Answered", each carrying who asked, what about, and how long it has
been sitting there; the message opens beside them. Below `lg` it is one pane at a time — the list,
or the message with a way back — and on a phone it deliberately does *not* auto-open the first
message, because the two panes are one screen there and the operator came to see the queue. Push
notifications deep-link to the message rather than to the top of the list.

Checked in a real browser at 1440×900 and 390×844: two panes at `340px 782px`, one pane on the
phone, no horizontal scroll at either size, and **no control under 44px** anywhere on the Inbox —
which caught three of my own (the subject links, the thread toggle) and one pre-existing (the
notifications button).

## The nine gaps, closed

A gap analysis against `SPEC.md` found nine things the build had declared and not done. All nine
are now built, each with tests. In the order the founder asked for them:

**1. Collaborators could not actually be spawned.** `collaborationList` was stored, rendered in the
UI, and named in every agent's prompt — and no tool implemented it. Template step 3 tells the
review coordinator to "spawn the four plan reviewers", which it physically could not do. There is
now `agentos_spawn_collaborators`: it creates one subtask per collaborator, starts them **in
parallel**, waits for all of them (bounded, default 20 minutes), and returns each one's status,
activity notes and attachments as the tool result. Three rails: the target must be on the spawning
agent's own list (checked in the control plane, not in the tool schema), eight spawns per session,
and a depth ceiling of two — a reviewer that can spawn reviewers is a loop with a budget.

**2. Attachments never travelled.** `attachmentIds` existed on every card and every writer
hardcoded `[]`; `attachmentsFromPrevious` was declared on all nine template steps and read by
nothing. So the spec written in step 1 never reached the plan agent in step 2. Now: an
`agentos_attach_file` tool (authorised as a *read* of that path, so it cannot launder a file out of
a folder the agent was never granted), a chain carry that runs before the next step is released,
attachments inherited by spawned collaborators, the paths listed in the session manifest, and
**read grants for exactly those paths** — the plan agent can open the spec agent's file without
gaining its folder. The operator's half is on the card and in the create form.

**3. The commit step of the lifecycle did not exist.** `commitShas` was a column nothing wrote and
`committing` a status nothing set. Both backends now answer for it: the local worker reads
`git log origin/<branch>..HEAD` out of the workspace *before* it is deleted (observed), and the
cloud path takes `agentos_record_commit` from the agent (attested — the runtime owns that container
and there is no later moment to go and look). The session sits in `committing` while it is
collected, and the shas render on the session.

**4. The filesystem was text-only.** Upload, download, and image preview, with one rule shared by
the API and the browser: a binary object refuses a text read rather than returning mojibake an
editor could save back over it. Agents get the same refusal, in words.

**5. Secrets had no production driver.** `GoogleSecretManagerProvider` sits behind the same
interface as the env driver, selected by `SECRETS_PROVIDER=gcp`. Bare names resolve against
`GCP_PROJECT_ID`; full paths and pinned versions are used as written; an unreadable secret returns
null so the session refuses the grant that needed it instead of starting half-configured.

**6. A goal had no shared state.** `/goals/{goalId}/` is now a real grant — read and write, never
delete, held by a session *because it is working that goal* rather than by its agent — and the
inbox has a thread view scoped to the goal, which is also what `inbox_read` returns.

**7. The local runner had one engine and no egress.** Grok in yolo mode is the second engine
(SPEC §16): an OpenAI-compatible tool loop with the same control-plane tools, plus a shell/read/
write/list toolset confined to the session workspace. And `LOCAL_RUNNER_EGRESS_MODE=proxy` starts a
per-session allow-list proxy the child is pointed at. Both are documented for what they are, and
round eight below tightened both: the proxy is a layer rather than a permission, and a Grok session
that carries a spend cap is refused rather than run unmetered.

**8. `inbox_read` was missing.** Agents could send and ask, never read. They can now read their own
task or goal thread — and nothing else, which is why it is scoped by subject rather than by inbox.

**9. The CLI could not create an agent.** `agentos agent create` (inbox access is opt-in, per
default-deny), plus `--title`, `--runner`, `--collaborators` and `--inbox/--no-inbox` on
`agent update`, and `skill create --kind file`.

## The test suite was spending real money

Worth writing down, because it was invisible and it is the kind of thing that only shows up when
someone times a run. The suite took **fifty minutes** and produced agent prose no `FakeRunner`
writes. The cause: `FakeRunner` replaces the *cloud* backend, and `LocalVmRunner` reads
`LOCAL_RUNNER_URL` from the environment — where a developer's `.env` points it at a worker that is
actually running on their machine. Under `auto` routing the router preferred it, so the suite had
been launching real Claude Code sessions against a real subscription: thirteen were still running
when this was found, and were terminated. The harness now blanks `LOCAL_RUNNER_URL`; the same
suite is **38 seconds**.

## Where we are

**All eight phases of `SPEC.md` §21 are built, the nine gaps found by a spec audit are closed, and
agents actually run.** 166 automated tests pass (144 control plane, 18 worker, 4 CLI), and the cloud runner,
the network wall, the inbox pause/resume cycle, vault cleanup, the local runner and its credential
proxy have each been exercised against real containers. Six
independent review rounds have each found real defects in the previous round's fixes — round six's
headline finding was that round five's session deadline could not actually stop a silent session,
and round seven was the first to clear the thing it was pointed at. Both backends were run end to
end on real containers, and the whole vault lifecycle was watched from outside AgentOS. Error
reporting (`RECIPE.md` A8) is wired and off by default.

| Phase | State |
|---|---|
| 0 — Skeleton | Done |
| 1 — MVP (task → session → destroy) | Built; acceptance test passes against a fake runner |
| 2 — Isolation | Built; grants, network policy, filesystem ACL, secret refs, file browser |
| 3 — Templates + gates + chains | Built; 9-step template, chain scheduler, cron/at scheduling |
| 4 — Goals | Built; DoD approval, orchestrator loop, spend/time/stuck rails |
| 5 — Triggers + automations | Built; signed webhooks, named cron automations |
| 6 — CLI / YAML | Built; `agentos.yml` round-trips through the CLI against the live API |
| 7 — PWA + live viewer + local runner | Built; SSE viewer, activity feed, web push, runner routing |
| Local runner | Built (`apps/local-runner`); a real task ran on it end to end |
| Deploy | Dockerfiles, `docker-compose.prod.yml`, `DEPLOY.md` |

## Verified on this build

`pnpm test` — **144 control-plane tests across 23 suites, 18 worker tests and 4 CLI tests**, in under a minute. New
coverage for the nine gaps:

| Suite | What it holds |
|---|---|
| `collaboration.spec.ts` | Spawn tool absent without a list; a target off the list is refused before any card exists; two reviewers run and their reports come back; the eight-spawn cap; a goal session may not spawn at all; a subtask this session did not spawn cannot be read |
| `attachments.spec.ts` | Attach refuses a file the agent cannot read; the chain carries step 1's spec to step 2; a session reads its attachment without gaining the folder, cannot write there, and cannot reach anything named beneath it; a commit is recorded, a malformed sha is refused, a repository the agent does not hold `git-write` on is refused, and an agent without the grant has no commits to record |
| `shared-state.spec.ts` | A goal session reads and writes its own folder, cannot delete from it, and cannot touch another goal's; a task session cannot reach a goal folder at all; `inbox_read` returns this card's thread and not another's, and is refused without inbox access |
| `files-binary.spec.ts` | Bytes round-trip; a text read of a binary object is refused; the agent is told what it found; a text file with a useless mime still reads |
| `secrets-provider.spec.ts` | Bare names, full paths and pinned versions resolve correctly; an unreadable secret returns null rather than throwing |
| `apps/local-runner/test` | The egress proxy refuses a host outside the allowlist over both plain HTTP and CONNECT, allows one inside it, and never routes loopback through itself; workspace tools refuse a path that climbs out; a granted binding named `HTTPS_PROXY` or `ANTHROPIC_API_KEY` is refused; the worker's own credentials never reach the child; the Grok loop forwards a control-plane tool call and finishes; a budgeted Grok session is refused; a missing Grok key fails loudly |

By hand against the running control plane and MinIO: a binary uploaded through
`POST /files/upload`, refused by the text read with a 400, downloaded byte-for-byte, attached to a
card, listed back through `GET /tasks/:id/attachments`, and both removed. `agentos push` → `pull`
is still byte-identical, and `agentos.yml` was regenerated — the copy in git had
`collaboration: []` for the review coordinator, so pushing it would have removed the very grant
that makes step 3 of the feature template work.

## Verified in the previous session

Automated (`pnpm --filter @agentos/api test`, 109 tests, 17 suites):

| SPEC §22 acceptance test | Suite |
|---|---|
| 1. Session destroy | `session-lifecycle.spec.ts` |
| 2. Filesystem ACL (write/delete/traversal/no-grant) | `isolation.spec.ts` |
| 3. Ungranted MCP absent from the manifest | `isolation.spec.ts` |
| 4. Network wall | `isolation.spec.ts` (see caveat below) |
| 5. Approval gate | `session-lifecycle.spec.ts`, `templates.spec.ts` |
| 6. Template chain (9 cards, order, variables) | `templates.spec.ts` |
| 7. Inbox resume | `inbox.spec.ts` |
| 8. Multiple choice | `inbox.spec.ts` |
| 9. Goal rails (spend / time / stuck) | `goals.spec.ts` |
| 10. DoD approval gate | `goals.spec.ts` |
| 11. Webhook auth | `triggers.spec.ts` |
| 12. YAML round-trip | `yaml.spec.ts` + live CLI |
| 13. Least-privilege support agent | `isolation.spec.ts` |
| 14. Orchestrator spawn list | `goals.spec.ts` |
| Runner routing (Phase 7 done-when) | `routing.spec.ts` |

Deploy artifacts, actually exercised:

- `docker build -f apps/api/Dockerfile` → 342MB image. The workspace is flattened with
  `pnpm deploy`, because copying pnpm's symlinked store into a scratch image does not survive.
- The containerised API applied migrations, started the queue worker, answered `/health` 200, and
  served authenticated `/projects` against the dev database.
- `docker build -f apps/web/Dockerfile` → 92MB nginx image.
- `docker compose -f docker-compose.prod.yml config` is valid.

By hand, against the running control plane:

- Production build boots (`node apps/api/dist/main.js`), 63 routes mapped, `/health` 200.
- `agentos pull` → `push` → `pull` is byte-identical (`ROUND-TRIP IDENTICAL`).
- `agentos template run` created the 9-card chain with `{{branchName}}` interpolated and the gate
  on the human step.
- `agentos goal create` created a goal in `draft` with a drafted checklist and told the operator it
  will not run until they approve it.
- Task → queue → worker → session row → task `todo→doing` → provision attempt → failure recorded on
  the session row rather than swallowed.

## The first real runs

A credential arrived, and four things that had only ever been asserted were tested against live
containers.

- **A task ran end to end.** Provision → `agentos_update_task` → done → archive. Task `done`,
  session `destroyed`, `$0.03` read back off the runtime, 24 log entries, a working Console trace
  link. Closes the "no agent has ever run" blocker.
- **The network wall is real, and now proven rather than asserted.** The same command
  (`curl -o /dev/null -w '%{http_code}' https://github.com`) run by the same image: **403 in
  `limited-none`, 200 in `open`.** The 403 comes from the runtime's egress proxy, not from GitHub.
- **Inbox pause and resume works against a real container.** An agent called `inbox_ask`, the
  session parked as `waiting-inbox` and the container stayed alive; answering the message resumed
  the *same* runtime session, which then finished and was destroyed.
- **The orphan sweep was broken, and the live run is what found it.** `sessions.list` takes
  `statuses` (plural, array) and accepts only `idle`/`running`/`rescheduling`/`terminated` — the
  code sent `status: "in_progress"`, which is a 400 every time. It would have reported zero orphans
  forever while logging an error nobody reads. Fixed and verified live: with a session parked, the
  corrected call returns exactly that container, with a parseable `created_at`.

That last one is the argument for doing this before trusting any of it. The suite was green
throughout; only a real response could have caught it.

## Fixed after the first operator look at the UI

The founder opened the app and reported "only the sidebar, nothing in the main area". Three real
defects behind that one report:

1. **`pnpm db:seed` and `pnpm db:migrate` never loaded `.env`.** They died on
   `DATABASE_URL is not set` — the exact commands `README.md` tells a new operator to run. Both
   scripts now pass `--env-file-if-exists=../../.env`. The Docker path is unaffected: it runs the
   compiled `migrate.js` with env supplied by compose.
2. **The database held 11 of the 14 role agents.** It had been seeded before `customer-support`,
   `diagnostic`, and `linkedin-content` were added to `ROLE_SEEDS`; the seed upserts, so nothing
   ever backfilled them. Re-seeded — 14 agents now. This also silently disabled
   `POST /triggers/install-examples`, which skips example triggers whose agent is missing.
3. **A rejected token was indistinguishable from an empty database.** Every page swallowed the
   query error and rendered its own empty state, so a stale token showed as
   "No project yet. Run `pnpm db:seed`" — pointing the operator at the wrong problem entirely, with
   no way to re-enter a token short of clearing site data. Now `ApiError` carries the HTTP status,
   `Layout` intercepts a failing project fetch and names the actual cause (rejected / unreachable /
   server error) with the raw message, and the sidebar has a permanent **Change token**.
   4xx responses are no longer retried, so the message is immediate.

Screens confirmed rendering at 1440×900 with a valid token: Tasks (four columns, 9-card chain, gate
captions), Agents (14 rows), Goals (list, create form, spend-cap acknowledgement), and the rejected-
token screen. This is a spot check, not the visual pass `RECIPE.md` A1.6 puts on the founder.

## Settings, and the two gaps it closed

Both of the deferred gaps were deferred for the same reason: they needed a policy decision that was
not mine to invent. The founder's answer was to make them settings — "anything I can change should
be on a settings page unless it belongs in env" — which is now a rule the codebase follows.

**`project_settings`** (migration `0008`), one row per project, read as defaults when absent, with
a Settings screen at `/settings`. The split it encodes: a *setting* is a judgement the operator
revises (how long to hold a container); an *env var* is a deployment fact (where the database is,
what the credentials are). Nothing that can be edited from a browser is a secret.

**Parked-session timeout — default 24 hours, `0` disables it.** A question unanswered by the next
day will not be answered inside that container's useful life. On expiry the container is freed, the
session is recorded `failed` with the reason, and the inbox message is **closed rather than
deleted** — what the agent wanted to know usually outlives the session that asked. A push goes out,
since the whole point is that you missed something. Below 30 minutes is refused by the schema: a
timeout that short reaps questions while you are still reading them.

**Orphan sweep — default on, every 15 minutes.** Lists what the runtime is running, compares against
the handles AgentOS holds, archives the difference. The interval is a setting; the **ten-minute
grace period is not**, because `provision` and `attachRuntime` are two statements apart and a zero
grace would archive containers that are seconds from being recorded. `Runner.listRuntimeSessions` is
optional — a backend that cannot enumerate its containers is simply never swept, which is why the
local runner is exempt.

`maintenance.spec.ts` covers both: reaping past the timeout, sparing a session inside it, `0`
meaning never, sweeping an orphan while sparing both a live handle and a just-started container,
honouring the off switch, and the schema bounds.

## The independent review, and what it found

Seven review subagents had gone idle without reporting, so the review was run through the **Codex
CLI** instead. It reported ten findings across five of six areas and refused the code:

> "No — I would not let this version hold production credentials or run unattended agents."

It cleared `fs-acl.ts` outright ("no findings"), along with the HMAC construction, the constant-time
compare, manifest project-scoping, and the local runner's authority boundary. Everything below is
now fixed, with a regression test in `review-fixes.spec.ts` unless noted.

| Finding | Sev | Fix |
|---|---|---|
| Runtime environments collided across projects: `agentos-<name>` carried no project and no policy digest, so two projects sharing an environment name shared one wall, and editing a policy never republished | High | The runtime name is derived from the project plus a digest of the policy; host order does not change identity |
| Vaults holding resolved secrets were never deleted — destroy archived only the session, stranding credentials at the provider forever | High | Vault ids travel on the handle, are persisted on the session (`0009`) so a resumed or swept session can still reach them, and destroy deletes them before archiving. **Verified live**: a session minted `vlt_…`, and zero vaults remained afterwards |
| The approval gate was checked, then written unconditionally — turning the gate on mid-flight still let an agent close the card | High | The gate is a predicate on the UPDATE, so the database settles it |
| Two concurrent completions both read "not done" and both released the next chain step — two agents for one step | High | Closing a card is a claim (`WHERE status <> 'done'`); only the row-winner advances, and the release carries a queue dedupe key |
| A failing `sessions.finish()` skipped `destroyQuietly()` — a database outage left containers running exactly when nothing could notice | High | Recording and destroying are separate concerns; destroy runs in a `finally` on every path, success included |
| A webhook's replay claim was spent before the task was created, so a failed dispatch lost the delivery permanently | High | The claim is released if dispatch fails, so the sender's retry works |
| Secret rotation lost to a delivery that had already read the old salt | Medium | The claim and a re-verification against the current salt happen in one transaction |
| Destroy failures were swallowed, so the row said `destroyed` while the container ran | Medium | The failure is appended to the session row, the handle is kept, and the orphan sweep now covers **both** backends — the local runner gained a session listing for exactly this |
| The local runner ignored granted MCP servers entirely | Medium | Granted servers are attached; a server granted for *specific operations* is refused instead, because Claude Code attaches a server whole and quietly widening a grant is worse than declining it |
| A repo `mountPath` of `/../../tmp/x` escaped the disposable workspace and survived cleanup | Medium | Rejected by the shared schema, and re-checked against the resolved path in the worker |
| File-backed skills were silently discarded | Low | `kind` and `filePath` travel with the skill; the prompt points the agent at the file |

## Round two: the review of the fixes

The second Codex pass reviewed the fixes and refused again — **17 findings, 2 Critical** — and it
was right to. Of eleven claimed fixes it verified three as fully correct. The most useful finding
was one it caught that no test could: the chain-release dedupe key was `chain-release:<uuid>`, and
BullMQ 6.1.1 rejects a custom job id containing `:`. That enqueue happens *after* the card commits
as done, so every template chain would have wedged permanently on its first step — and the
regression test missed it because the stub replaced `enqueueRun` with a signature that ignored the
argument. The stub now validates the key the way BullMQ does.

All 17 are fixed. The two Criticals:

**The local runner handed its Claude credential to the agent.** It went into the child process's
environment, and the agent has Bash and `bypassPermissions` — `env` prints it, one request sends it
anywhere. A subscription token is worth far more than one session. There is now a per-session
loopback **credential proxy** (`apps/local-runner/src/credential-proxy.ts`): the child gets a
placeholder key and a `127.0.0.1` base URL, and the real credential is injected only inside the
proxy, which dies with the session. **Verified live** — an agent asked to print its own
`ANTHROPIC_API_KEY` prefix returned `sk-ant-local-`, not `sk-ant-api03-`, and the run still worked.

**A failed vault delete was reported as a clean destroy.** The error was caught and logged, the
session archived anyway, so `recordDestroyFailure` never fired and the session left the listing that
would have retried it. `destroy()` now attempts every vault, archives regardless — freeing the
container is never worth skipping — and then throws, so the failure reaches the session row.

The rest, briefly: vaults created before a failed `provision` are deleted rather than orphaned; the
reaper carries `runtimeVaultIds` (it was archiving credential-bearing sessions without them);
`expire()` claims the parked row conditionally so an answer arriving in the same moment wins, and
destroys in a `finally`; the symlink escape is closed by comparing `realpath(parent)` rather than a
lexical prefix; rotation and delivery now take the same `FOR UPDATE` row lock, because grouping a
read and a write in one transaction does not serialize them under `READ COMMITTED`; a task whose
schedule cannot be queued is deleted rather than left inert; the local runner attaches the control
plane's `agentos` tools *last* so a granted server cannot displace them; the sweep respects a
project's opt-out via `agentos_project` metadata and refuses to touch containers it cannot
attribute; runtime names carry the full project id; `patch()` decides "closing" from the update
predicate rather than an earlier read; saving settings reschedules the heartbeat; and YAML shares
the mount-path and file-skill schemas, so `agentos push` is no longer a way around them.

## Round three: what a third pass found

Codex reviewed the fixes again — **12 findings, 1 Critical** — and verified ten of the previous
round's fixes as correct. All twelve are now addressed, with one honest exception described below.

The two that mattered most were about the local runner. **The credential proxy was an open oracle**:
the agent knows `ANTHROPIC_BASE_URL`, and the proxy authenticated nothing and restricted no path, so
a compromised agent could drive the real credential directly and bypass the SDK's budget accounting
entirely. It now requires the placeholder as a bearer token and forwards only `POST /v1/messages`
and `/v1/messages/count_tokens`. Verified from inside a live sandbox: `/v1/models` → 403, an
unauthenticated call → 401, a wrong method → 403.

**The Critical cannot be fixed in code.** An agent with a shell, running as the same unix user as
the worker, can read `/proc/<pid>/environ` and recover the credential the worker loaded. Replacing
the child's environment defeats `env`; it does not create a boundary between two processes under one
user. What changed instead: the worker accepts `CLAUDE_CODE_OAUTH_TOKEN_FILE` so the secret is never
in its environment block at all, `DEPLOY.md` §6 now states a dedicated unix user as a requirement
rather than advice, and the backend stays off unless `LOCAL_RUNNER_URL` is set.

That work also uncovered a bug of my own that no review caught: the Agent SDK **replaces** the
child's environment rather than merging it, so sessions had no `PATH` and their Bash tool had only
shell builtins. It looked like a hardened sandbox and was actually a broken one. The child now
inherits the worker's environment minus every credential, checked by name — an agent asked to print
`AGENTOS_OPERATOR_TOKEN` reports `absent`.

The rest: a running session is now interrupted before it is archived (Anthropic refuses to archive a
running session, so cleanup was failing exactly when it mattered); a vault that fails half-built
deletes itself; vault ownership is recorded *before* the runtime session exists, closing the crash
window; failed vault deletions stay on the session row, which makes the row itself the retry queue
that maintenance drains; an inbox answer claims its session so it cannot land on a container the
reaper already took; goal iteration counters increment in SQL rather than read-then-write, so two
dispatches finishing together cannot undercount the rails; a chain release lost to a queue outage is
re-released by maintenance instead of wedging; the local runner's destroy throws instead of
reporting success; a mount path whose destination is already a symlink is refused; and a `limited`
environment now permits MCP exactly when the agent was granted an MCP server — before this, every
granted MCP tool in a limited environment was dead on arrival.

## Round four: nine findings, and the one that cannot be fixed

The fourth pass called the cloud path "materially improved" and still refused it, on four specific
bugs. All nine findings are addressed; two of them only bounded, for reasons below.

**A goal specialist that parked on a question still advanced the loop.** `runGoalStep` swallowed
`parked`, so the orchestrator counted a finished iteration, logged "parked" as *progress* — which
also defeated the stuck rail — and dispatched the next specialist while the first container sat
holding an unanswered question. The loop now stops on a park and says so in the progress log;
answering the question resumes that session, records its spend, and queues the next turn from
`resumeSession`. Without that last piece the goal would simply have stalled forever instead.

**Goals had no single-flight guard.** Two iteration jobs — from a double approval, a retry, anything
— each read the same remaining budget and could each spend all of it. A goal now holds a
`dispatch_lease_at` (migration `0010`) for the length of its dispatch; duplicates lose the claim and
exit. The lease expires so a dead worker cannot freeze a goal permanently.

**A rejected inbox answer stranded its session.** The claim ran before validation, so an invalid
choice left the session `running`: invisible to the reaper, untouchable by a retry, container alive.
Validation now comes first, and any failure after the claim returns the session to the park.

**Vault cleanup was not crash-safe.** `sessionsWithPendingVaults` selected terminal rows only, so a
crash between minting a vault and attaching the runtime left credentials that nothing would ever
collect. It now also picks up sessions stuck in `starting`, cleans them, and closes the row.

The rest: a repo granted without a credential is now **refused at provision** rather than silently
dropped while the prompt still advertised it; a local worker that will not take a session (because
it cannot enforce a limited network) now falls back to the cloud runner instead of failing the run —
which is what the docs had been promising; and a failed workspace deletion stays retryable, because
marking the session finished first hid it from the retry.

**The Critical stays open, and the documentation was wrong about it.** I had written that deploying
the worker as its own container satisfies the "dedicated unix user" requirement. It does not: the
worker and Claude Code both run as `node` inside that container, so an agent can still read
`/proc/<worker-pid>/environ` — and the `0600` credential file, which the same user owns. The
container protects the host, the control plane, and the database from agent code; it does not
protect the worker from the agent it launched. `DEPLOY.md` §6 now says exactly that, and adds the
only advice that actually helps: use a revocable `claude setup-token`, not an API key on a large
balance. A per-session request ceiling (`LOCAL_RUNNER_MAX_SESSION_REQUESTS`, default 500) bounds
what a compromised agent can spend through the proxy, since the SDK's own budget covers only the
calls it makes.

## Round five: the goal loop, reviewed for the first time

Round four rewrote the loop itself, so round five was pointed at it. **Nine findings — five High,
four Medium — and a fifth refusal.** It also verified the previous round's ten claims: two
CONFIRMED, eight PARTIAL. It raised nothing new about the local-runner credential, which is the
known-open item it was told not to re-litigate.

The theme is that the loop is a chain of queue jobs, and every link was a place a goal could stop
existing without anyone being told.

**A goal stopped counting money the moment a session failed.** `failAndRelease` never read spend
before destroying, so a specialist that died after provisioning was booked at `$0`. The next
iteration then read the *full* remaining budget again — a repeatable failure could spend the cap
many times over while the cap itself read as untouched. Teardown now reads the cost while the
container still exists and hands it back, on the failure path as well as the success one.

**The stuck rail could not fire.** "Progress" meant the progress log got longer, and *everything*
lands in that log — the specialist's own prose, the orchestrator's dispatch line, the failure
summary of a session that achieved nothing. Any of them reset the counter. Progress is now a
counted signal (`progress_marks`, migration `0011`) bumped by exactly two things: an agent
recording work through its activity tool, and a checklist item flipping to done. Model prose does
not count. A parked turn is now counted as an iteration too — a specialist that only ever asks
questions is precisely what the rail is for.

**A reaped question stalled its goal forever.** When a parked specialist timed out, the reaper freed
the container and closed the message — and nothing queued the goal's next turn, because the resume
that would have done it was never going to happen. The goal sat `active` with no session, no job,
and no error anywhere the operator looks, and its pre-park spend was never counted. Reaping a goal
session now reads its cost, books it, and stops the goal with a reason that says what happened.

**Nothing recovered a goal whose successor enqueue was lost.** Goal jobs get one attempt; a Redis
blip at the wrong statement ended the goal permanently. `GoalContinuity.recoverStalledGoals` is the
sweep for that — it re-queues an active, approved goal that has no live session and no held lease
and has sat untouched past a grace period. Safe to repeat, because a duplicate loses the dispatch
lease and stands down.

**An answered question could become unanswerable.** The message committed as `answered` before the
resume job was queued. When the queue refused it, the session went back to the park but the message
did not — and the guard at the top of `reply` rejects anything already answered. The container had
no way back. Both halves are now restored together.

**Two vault paths could strand credentials for good.** A vault whose build failed *and* whose
compensating delete also failed had never been reported to anyone, so no row, handle or sweep knew
it existed. Ownership is now recorded the moment the vault is created, before anything is written
into it, and `deleteVaults` treats a 404 as success so the retry cannot wedge on a vault that is
already gone. Separately, `sessionsWithPendingVaults` took the newest 200 sessions and *then*
filtered, so a stranded vault became invisible as soon as 200 newer sessions existed — permanently.
It is a SQL query now, oldest first, so the page drains the backlog rather than the fresh end of it.

The rest: the dispatch lease carries an ownership token and is renewed while a specialist runs, so
it cannot expire under live work and a stale holder cannot clear the lease of whoever took over;
goal completion is decided by the persisted checklist rather than the evaluator's verdict, because
the evaluator reads a log that agents write; the goal's time rail now travels *into* the session as
a deadline (`DeadlineStream`), so a specialist started one minute inside the limit is cut off at it
instead of running for hours; the local runner's timeout path keeps a session whose workspace could
not be removed instead of dropping it from the map on an unhandled rejection; and the local runner
refuses a repo granted without a credential, which the cloud path already did.

**The `:`-in-a-job-id lesson got a structural fix, not another patch.** BullMQ's real rules are now
one exported function (`assertValidJobId`) that the queue and the test stubs both call, and there is
one shared queue stub instead of four hand-rolled ones — two of which still dropped the dedupe key
on the floor. Transcribed from BullMQ 6.1.1's own `validateOptions`, which also rejects an all-digit
id, and tolerates a colon only when there are exactly two.

## What the live runs proved, and what they could not

`RECIPE` A1.7 again: the suite went 77 → 92 green, and that is the weakest signal here.

**Verified live, on this build, against a real container:** a task ran end to end on the local
runner — 8 events consumed through the new `DeadlineStream` wrapper, `agentos_update_task` answered
by the control plane, card `done`, session `destroyed` with no error, `$0.64` read back. That
wrapper now sits in front of *every* runtime event stream, so proving it against a real one rather
than a fake generator was the point.

**And the live run found a defect no test could.** The first local run reported
`container was not destroyed: ENOTEMPTY … rmdir '/tmp/agentos-local/session-LP39gD/.omc/…'`. The
agent's own tooling was still writing under the workspace as it was torn down, and `fs.rm` does
**not** retry by default. Six abandoned workspaces were sitting on disk from earlier sessions, so
this had been happening for a while and nothing had noticed. Fixed with `maxRetries`, and verified
by rerunning: destroy clean, zero workspaces left.

**The cloud runner, after the founder replaced the key mid-session.** The old `ANTHROPIC_API_KEY`
was dead — `GET /v1/models` returned `401 API key is invalid` straight from Anthropic, and every
cloud session failed at provision with that 401. Worth keeping as a data point: the failure path
behaved correctly under a real outage, recording the provider's error on the session row rather
than swallowing it. With the new key:

- **A task ran end to end on the cloud runner.** 24 events consumed through `DeadlineStream`,
  `agentos_update_task` answered by the control plane, card `done`, session `destroyed` with no
  error, `$0.03`.
- **The whole vault lifecycle was watched from outside AgentOS.** An env binding was granted to the
  agent's environment so a session would actually mint a vault, and the provider's own vault list
  was polled alongside the session: **0 before, 1 while running, 0 after destroy**, with the session
  row's `runtime_vault_ids` cleared to `[]` and no destroy failure recorded. That is the round-five
  change — recording vault ownership at creation rather than after the vault is filled — proven
  against the real provider rather than a fake. The probe binding, its secret ref and the agent's
  temporary environment were removed afterwards; the project is back to its seeded state.

**Round six, verified live on its own build.** Both backends again, after the cancellation rewrite
touched every event stream: cloud — 24 events, card `done`, `destroyed`, no error, `$0.03`; local —
8 events, `destroyed`, no error, `$0.64`, zero workspaces left on disk and an empty session map, so
the cleanup path released its map entry correctly.

**Also confirmed live, incidentally:** round four's claim 7. An agent with no environment resolves
to `limited-none`, the local worker refuses it because it cannot enforce egress, and
`provisionWithFallback` moved the session to cloud rather than failing the run.

## Round six: the deadline did not work

Round six reviewed round five's own fixes — **12 findings, five High** — and the first one is the
reason this project keeps paying for reviews.

**The deadline added in round five could not stop a silent session.** It worked by wrapping the
event stream and abandoning the iterator at the cut-off. But calling `return()` on an async
generator that is blocked inside `next()` queues the return *behind* that pending read; it does not
interrupt it. So the one case a deadline exists for — a session that has gone completely quiet — was
the one case that hung the consumer instead of ending it, leaving the container alive and a queue
job holding it. The round-five test passed because its fake stream resolved after ten seconds: the
timer was ending the run, not the deadline.

Cancellation now has to reach the socket. `streamEvents(handle, seen, signal?)` is part of the
`Runner` contract, both backends hand the signal to their own request, and `RunCancellation` owns
the deadline, the external revoke, and the timer. The new test's stream **never resolves** — reverting
the fix makes it hang until the test times out, which is exactly the production symptom.

**The stuck rail was forgeable, and one bug made it worse.** Any non-empty `agentos_add_activity`
call minted a progress mark, so a prompt-injected agent could reset the rail every turn with
"still working". Separately, `stuckCount` reset whenever the next specialist differed from the last
— and a different specialist is what a stuck goal *looks like*, so two agents alternating could
circle forever without the counter passing one. The reset is gone, and there is now a hard ceiling
(`MAX_ITERATIONS`, 100) that counts dispatches and nothing else: the one rail no agent can talk out
of firing. The progress sample also moved before the evaluator ticks the checklist, so a completed
item finally counts as the progress it obviously is.

**Losing the dispatch lease did not stop the specialist.** Renewal noticed and logged, and the old
run carried on spending beside its replacement — the exact double-spend the lease exists to prevent.
`DispatchLease` now revokes through the same abort signal, so lease loss ends the session.

**Three ways a goal still lost money or stalled.** A *resumed* session that failed discarded its
cost and left the loop with nothing queued; the reaper skipped both the spend booking and the goal
stop if closing the inbox message threw; and a resumed turn ignored the goal's time rail entirely,
so a goal could park just inside its limit and then run unbounded.

The rest: the inbox rollback now restores the message and the session in one transaction, because
either half alone leaves a container that nothing can reach; recovery excludes live goals in SQL
*before* the page limit and carries a dedupe key, so a backlog of parked goals cannot starve a
stalled one and two passes cannot double-dispatch; vault cleanup pages by cursor, so a few
permanently-failing rows cannot hide every newer credential behind them; vault ownership is recorded
inside the guarded block; and the local runner now separates "the run ended" from "the workspace is
gone" — the stream closes immediately either way, and a directory that will not delete keeps the
session listed so the sweep retries it instead of forgetting it.

## Error reporting, and why it is not optional here

`RECIPE.md` A8 asked for GlitchTip and it was the one real code gap left. The premise of this
product is that nobody is watching, which makes a failure that only reaches stdout a failure that
did not happen — and it has bitten twice: a broken orphan sweep logged a 400 on every pass and would
have reported zero orphans forever, and six abandoned workspaces sat on a disk for days because a
destroy failure only ever reached a log line.

Behind an interface with a log driver as the default (`RECIPE.md` A2), so nothing leaves the machine
until `GLITCHTIP_DSN` is set. Wired to the things nobody watches: every maintenance job, a container
that could not be destroyed, a queue job that failed (jobs get one attempt — that failure is final),
an inbox rollback that could not be completed, any API 5xx, and unhandled rejections. 4xx is
deliberately not reported: a Zod rejection is the API working.

**Scrubbing is the part that matters.** This app's errors are unusually dangerous to ship raw — the
tool-call log carries task text and agent prose, and a provisioning failure quotes the one request
that carried resolved secrets. Credentials are redacted by pattern *and* by exact value for every
known secret env var; narrative fields are dropped outright rather than pattern-matched, because
there is no regex for "this sentence names a customer"; and Sentry's default integrations are off,
since they attach request bodies and local variables. Proven on the wire, not asserted:
`error-reporting.spec.ts` stands up an HTTP server, captures the actual envelope, and asserts the
Anthropic key and the operator token are absent from the bytes while the useful tags survive.

## Round seven: severity finally falling

Round seven reviewed round six — **7 findings, three High** — and, for the first time, cleared the
thing it was pointed at. The cancellation rewrite was checked transport by transport and found
sound: the signal reaches the SDK's request on cloud and undici's socket on local, `AbortError` and
`APIUserAbortError` are the right names for these implementations, an unrelated abort-shaped error
is only swallowed after our own cancellation fired, `reader.cancel()` runs on every exit path
including a park, and null / already-past deadlines behave.

The three blockers it did find were all real.

**Recovery could wedge a goal permanently.** The recovery job id was `goal-recovery-<goalId>`, and
BullMQ treats an existing job with that id as a duplicate *even after it has completed* — completed
jobs are retained (`removeOnComplete: 500`). On a single-operator install that first job can sit in
Redis for months, so every later recovery of the same goal returned it and created no runnable work,
while maintenance logged the goal as recovered. The key now carries the stalled state's `updatedAt`:
two sweeps of the same stall still collapse to one job, a genuinely new stall gets its own.

**A resumed session held no lease.** It was excluded from recovery only while its `startedAt` was
inside the lease window, so a session parked over an hour and then answered looked idle — and
maintenance could dispatch a second specialist against the same budget, with no way to revoke the
first. Resume now takes the same dispatch slot and passes its revocation signal into the session. If
the slot is already held it still resumes (the container is real and the operator answered it) but
does not queue the next turn, because that belongs to whoever holds the slot.

**A granted secret could survive scrubbing.** The scrubber knew credential *shapes* — Anthropic
keys, URL credentials, 64-hex — and a bare GitHub token, a JWT or an MCP server's opaque bearer
matches none of them. They reach error text by an ordinary route: a runner quotes the response that
failed and the reporter ships it. Values are now registered in a process-local redactor as the
manifest resolves them, so redaction is exact-match rather than guesswork. This only mattered with
`GLITCHTIP_DSN` set, which is off by default.

The rest: a `maxDurationMinutes` beyond ~24.85 days fired its deadline *immediately*, because
`setTimeout` clamps anything above 2^31-1 ms to 1 ms — the deadline is now armed in chunks; the
iteration ceiling counted dispatches that *returned* rather than dispatches that *started*, so a
worker dying mid-specialist launched a container without spending a slot, and the iteration is now
reserved before provisioning; and the successor iteration was enqueued while the current job still
held the lease, where a free worker could pick it up, lose the claim and exit — it is enqueued after
the release now.

**Verified live on this build:** cloud task, 24 events, card `done`, `destroyed`, no error, `$0.03`.

## Security review of the trust boundaries

Five review subagents were dispatched across two attempts and none returned findings, so this pass
is mine — read it as one pair of eyes, not two. Files: `fs-acl.ts`, `webhook-signature.ts`,
`triggers.service.ts`, `manifest.ts`, and the approval gate in `tasks.service.ts`.

**Fixed — every project env var reached every agent (high).** `ManifestResolver.resolveEnvVars`
selected `where projectId = …` with no environment filter, and `env_bindings` had no environment
column at all. Any agent with *any* environment set received *every* environment variable in the
project, secret values resolved. An agent in `limited-none` held the production credentials. SPEC
§5.6 says a secret is injected "only if the agent/environment lists them", and `README.md` promises
an agent gets "no … env var … that is not listed on it"; both were untrue.
Bindings are now environment-scoped (`0006`), keyed unique per environment so `API_TOKEN` can differ
between staging and production, and the resolver filters on the agent's own environment. Existing
rows keep a null environment and are **never injected** until assigned — fail closed rather than
migrate-and-hope. `isolation.spec.ts` now asserts a staging agent gets the staging value and never
the production one; reverting the resolver makes it fail with two vars instead of one, which is how
the guard was checked.

**Fixed — a signed webhook was replayable for five minutes (medium).** The signature covers the
timestamp, so a captured POST could not be back-dated, but nothing recorded that a delivery had
been spent. Re-sending it inside the window created another task and another container every time.
Deliveries are now claimed by a unique `(trigger_id, signature)` row before any work happens (`0007`),
with the digest normalised so re-casing or re-adding the `sha256=` prefix is the same delivery. Two
simultaneous replays lose at the index rather than in application code.

**Fixed — two smaller holes in `fs-acl.ts`.** `/agents/plan` was denied while `/agents/plan/` was
allowed, so an agent could not list its own home by the obvious path. And `agentHomeFolder("")`
returned `/agents/`, which would have granted read and write over *every* agent's home; an empty or
separator-bearing slug now yields no home grant at all, and the session prompt stops advertising a
home the ACL would refuse. Neither was reachable through the API today — agent names are validated —
so these are walls for the day someone adds a caller that forgets.

**Looked at and left alone.** Cross-project reads: `resolveMcp`/`resolveRepos`/`resolveSkills` all
scope by `projectId` alongside the id list, so a stolen id from another project resolves to nothing.
Traversal: `normalisePath` rejects `..` outright rather than resolving it, and prefix matching uses a
trailing slash, so `/agents/plan-evil/` does not match `/agents/plan/`. Timing: the signature compare
is length-checked then `timingSafeEqual`. The approval gate refuses `actor === "agent"` on any gated
card and the chain scheduler releases the next step only on a real non-done→done transition.

## Correctness review of the session lifecycle

Same story as above — the review agents assigned to this never reported, so this is also mine.

**Fixed — a failed run leaked its container (high).** `runTask` and `runGoalStep` caught a failure,
recorded the session as `failed`, and returned *without destroying the container*. Anything that
threw after provisioning — a dropped event stream, a tool handler error, a database blip — left a
sandbox running with nothing in AgentOS pointing at it. It bills until someone notices. The class
comment claimed "destroyed on every exit path" and `resumeSession` did do it, which is what made the
gap easy to miss. All three paths now go through one `destroyQuietly`, which logs and swallows a
destroy failure so it cannot mask the error that actually caused the run to fail.
`session-lifecycle.spec.ts` covers it; removing the fix makes it fail with `destroyed` empty.

**Fixed — the stuck rail depended on a magic number.** Progress was "the log grew by more than
`brief.length + agentName.length + 64`" — an estimate of the dispatch line's own length. Change the
log's timestamp format and the rail either stops a working goal or lets a circling one run. It now
measures the log length *after* writing the dispatch line and compares against that.

**Fixed — an environment was looked up by id alone.** `environmentPolicy` selected on
`environments.id` with no project scope. Network policy is a wall; a wall must not be borrowable
across projects even in principle. Now scoped to the agent's own project.

**Looked at and left alone.** Inbox resume refuses a message that is not `open` and a session that
is not `waiting-inbox`, so a double answer cannot double-resume; the reconnect seeds `seen` from the
persisted log, so replayed events are dropped. The chain scheduler releases the next step only on a
real non-done→done transition. One theoretical race remains: two answers arriving in the same
millisecond both read `open` before either writes, since the update is not conditional. Single
operator, single browser — noted rather than churned.

**Judged, not fixed:** `signingKey()` falls back to `AGENTOS_OPERATOR_TOKEN` when
`WEBHOOK_MASTER_SECRET` is unset. Anyone holding the operator token already owns the API, so this
grants no new power — but it silently re-keys every webhook when you rotate your login. Production
should set the dedicated secret; `.env.example` says so.

## The architectural call that shaped everything

**Anthropic Managed Agents (CMA) is the runtime, not the Claude Agent SDK.** CMA already provides
what `SPEC.md` §3 asks a runtime for: a per-session sandbox, environments with an egress allowlist,
versioned agent configs, vault credentials substituted at egress, an SSE tool-call stream, session
spend caps, cron deployments. AgentOS is the control plane and the policy on top.

Consequences visible in the code:

- `Runner` (`apps/api/src/runner/runner.types.ts`) is the SPEC §16 interface. `CloudManagedAgentsRunner`
  and `LocalVmRunner` implement it; `RunnerRouter` picks per session.
- **Inbox pause/resume is a custom tool call.** The agent calls `inbox_ask`, CMA idles the session
  with `requires_action`, AgentOS parks it as `waiting-inbox` and does *not* destroy the container;
  the operator's answer is delivered as the tool result, which is what resumes it.
- **The runtime session is archived, not deleted,** at the end of a run. Archiving frees the
  container — the destroy SPEC §6 requires — while keeping the Console trace inspectable.
- **Secrets never enter a container.** Repo tokens go to the runtime's git proxy; MCP and env-var
  credentials go into a runtime vault and are substituted at egress. The container sees placeholders.

## Deliberate deviations from SPEC.md

| Spec | Built | Why |
|---|---|---|
| §3.4 stack (Hono/Fastify + Prisma + pg-boss) | NestJS + Drizzle + BullMQ, pnpm/Turborepo | §3.4 self-labels as an assumption; `RECIPE.md` A7 is binding |
| §20 AgentOS/Inbox MCP behind a session-scoped token | Custom tools answered by the control plane | Same authority boundary one layer earlier: no token exists to hand a container, so none can leak |
| §4 webhook `secretId` → secret store | Per-trigger salt in the DB; key derived from `WEBHOOK_MASTER_SECRET` | A stolen database yields salts, which sign nothing. Strictly stronger than storing a reference |
| §17 model ids (`claude-opus-4`, `grok-4.6`) | `claude-opus-5` planners, `claude-sonnet-5` workers | The spec's ids predate the current model line |
| §11 DoD drafting "or a planning call" | Heuristic draft from the spec's own bullets | Honest and instant; the operator edits it before approving anyway. A model-backed drafter drops in behind the same call |
| §16 "Grok in yolo mode" on the local VM | An OpenAI-compatible tool loop against xAI, with a workspace shell | There is no Grok CLI that speaks the AgentOS tool protocol. Shelling out to one would have left the agent unable to update its own task, which is the whole contract |
| §5.5 network wall on the local runner | `none` (refuse) by default, `proxy` opt-in | A userland worker cannot hold a socket the agent opens itself. The proxy is real enforcement for every ordinary client and is documented as not being a cage |
| §6 "commit, record sha" | Observed on local, attested on cloud | Only a backend that still holds the checkout can observe it; the cloud runtime owns the container and destroys it. The two merge on the session row |

## Round eight: Codex reviewed the nine gaps and refused them

Eleven findings — three Critical, four High, four Medium — and it was right to block. What it found
was mostly the same shape: a capability added without asking what it does to a rail or a wall.

**A goal specialist could spawn its way out of every rail (Critical).** Spawned subtasks run as
ordinary task sessions: no budget, no deadline, and they outlive a goal that stopped. Eight per
session, two deep, is up to 72 uncharged descendants of a goal with a $5 cap. **Spawning is now
refused outright from a goal session** — a goal grows by orchestrator dispatch, which is the thing
that counts spend, time and iterations before it starts anything.

**`LOCAL_RUNNER_EGRESS_MODE=proxy` was treated as permission (Critical).** It made the worker accept
`limited`-network sessions, and the proxy is a wall an agent with a shell can walk around. That is a
promise the process cannot keep, and it replaced a fail-closed default. The proxy is now a *layer*:
accepting a limited session still takes `LOCAL_RUNNER_ALLOW_UNENFORCED_NETWORK=1`, the operator
asserting the machine itself is confined, and the proxy applies on top of that.

**A Grok session ran unmetered under a spend cap (High).** xAI reports tokens, not dollars, so a
capped goal could spend without the cap ever moving. A session carrying a budget is now **refused**
by that engine, and turns are bounded by `LOCAL_RUNNER_MAX_SESSION_REQUESTS`.

**An attachment grant opened a subtree (High).** Attachments were stored as ordinary folder grants,
and a folder grant is a prefix — so attaching `/private/report.md` also opened
`/private/report.md/secrets`. `FilesystemGrant` gained `exact`, and the ACL matches it as one path.

**A granted environment variable could switch containment off (High).** Session bindings were
applied *after* the credential and egress proxies, so a variable named `HTTPS_PROXY` or
`ANTHROPIC_BASE_URL` reconfigured the runtime. Reserved names are now refused and logged, and the
runtime's own values are applied last regardless.

**The worker's Grok key was readable by the agent it launched (Critical, bounded).** The same
`/proc` exposure the Claude credential has always had on this backend, which is documented and
unfixable in userland — but the key was also in the child's environment. It is stripped by name now,
and `GROK_API_KEY_FILE` keeps it out of the worker's own environment block.

**Local commits are recorded and then deleted (High, reported not fixed).** This worker clones with
a credential and strips it from the remote, so nothing on this backend can push. Commits found in
the workspace are still recorded — they are what happened — but the session log now says plainly
that they exist only in a directory about to be deleted, and points `git-write` agents at the cloud
runner, whose runtime git proxy can push. Making the worker push on an agent's behalf is a product
decision, not a bug fix.

The four Medium findings are fixed: a commit is recorded only against a repository the agent holds
`git-write` on (and the local collector skips `git-read` repos); `attach` is one atomic statement
rather than a read-modify-write two sessions could lose; the CLI's `agent create` no longer grants
inbox access unless `--inbox` is passed; and the create form no longer claims an agent reads binary
attachments, which it cannot.

**A second Codex pass on the fixes cleared eight and blocked three more**, all fair:
`GROK_API_KEY_FILE` was withheld from the child's environment but not from the *reserved binding*
list, and the path is as good as the key; the local-only commit warning was emitted onto an event
stream the consumer had already stopped reading, so it reached nobody — the control plane writes it
onto the session row at teardown now; and `agent create` defaulted the inbox to off silently, which
is the same trap as defaulting it on, so it now refuses without `--inbox` or `--no-inbox`. It also
caught `budgetUsd: 0` slipping past the Grok refusal (a goal that has spent its cap dispatches with
exactly that), a request ceiling that coerced a misconfigured `0` into "one turn", and startup
telemetry that announced "allow-list proxy" while every limited session was in fact being refused.

Each fix has a regression test, including the proof cases the second pass said were missing: the
network-acceptance decision as a pure function, `GROK_API_KEY_FILE` in both denylists, the request
ceiling actually stopping a loop, two concurrent `attach()` calls keeping both files, the local-only
warning landing on the session row, and commit collection run against a real git repository where a
`git-read` repo is skipped and a `git-write` one is not.

**A third pass cleared everything but one edge, and it was the good kind.** `agent create` refused a
*missing* inbox choice and accepted a contradictory one — `--inbox --no-inbox` together read only
the first flag and granted the capability, which is exactly what a script assembling flags in a loop
produces. The decision is one function now (`inbox-choice.ts`), it refuses both the missing case and
the contradictory one, `agent update` shares it, and the CLI has its own suite covering all four
shapes. The suite is **144 control-plane tests, 18 worker tests, and 4 CLI tests**.

**Round eight ended GO on the fourth pass** — four rounds of review over one session's work, which
is the trend continuing: eleven findings, then three, then one, then none. Every blocker it raised
was real, and the three Criticals were all the same mistake in different clothes — a capability
added without asking what it does to a rail or a wall. The one thing it cleared on the first pass
and never revisited is worth naming: the walls this build already had (`fs-acl`, manifest scoping,
the approval gate, webhook replay) held under all nine new capabilities.

## Known limits of what was just built

Written down rather than discovered later:

- **A Grok session records no cost**, so it is refused a budget rather than run under one. Time and
  iteration rails still apply, and the cloud runner is where a capped goal belongs.
- **`LOCAL_RUNNER_EGRESS_MODE=proxy` is a layer, not a permission.** It holds every ordinary client
  through `HTTP_PROXY`; it does not hold an agent that opens its own socket, and it does not on its
  own let a limited-network session run here.
- **The local runner cannot push.** A `git-write` grant on this backend produces commits that die
  with the workspace; the session log says so, and those agents belong on the cloud runner.
- **The spawn tool blocks its own tool call while it waits.** The session stays `running` and its
  container stays alive for up to the wait (20 minutes by default). A worker that dies mid-wait
  leaves that container to the orphan sweep, the same as any other crash mid-run.
- **Binary attachments are for the operator.** An agent's `fs_read` refuses them by design, so a PDF
  on a card is something you read, not something its agent does.

## Blocked / unverified — needs the founder

1. **The UI has had a spot check, not a visual pass.** Four screens were opened at 1440×900 (see
   above). Nothing has been looked at on a phone, no long-content or error-state sweep was done,
   and `RECIPE.md` A1.6 still puts visual verification on the founder.
2. **Push notifications are half-verified.** VAPID keys are generated and the API now serves
   `/push/public-key` with `enabled: true`. What is untested is the rest of the path: a browser
   subscription, and a real send. Both need you to click "enable notifications" once.
3. **The local runner cannot keep its credential from its own agent.** Claude Code runs as the
   worker's unix user, so a prompt-injected agent can read `/proc/<worker-pid>/environ` — or the
   `0600` credential file, which that same user owns. The proxy stops the easy read and the request
   ceiling bounds the abuse, but there is no boundary between two processes under one user, and a
   container does not add one because both run as `node` inside it. Use a revocable
   `claude setup-token`, not an API key on a large balance — or leave the backend off, which is the
   default. It also cannot enforce egress, so it refuses `limited`-network sessions and the
   orchestrator falls back to the cloud runner. All of this is in `DEPLOY.md` §6.
4. **Seven review rounds. Severity is finally falling, and round seven's fixes are unreviewed.**
   Every round through six found real defects in the last round's fixes — the invalid BullMQ job id
   would have wedged every template chain; round five's `$0` spend booking would have let a failing
   goal spend its cap repeatedly; round six found that round five's own deadline hung instead of
   cutting off a silent session. Round seven was the first to *clear* what it was aimed at (the
   cancellation rewrite, checked transport by transport), and dropped from five High to three. No
   round since four has found a Critical or an isolation break, and the walls — `fs-acl`, manifest
   scoping, webhook replay, the approval gate, the tool handler — have each been checked clean more
   than once. Round seven's own three fixes have not been reviewed by anyone.
5. **`.env.example` line 9 was twice found holding a real token.** The founder confirmed that was
   their own doing, not a stray process. Blank now; worth a glance before the first commit.
6. **None of the nine new capabilities has run against a real container.** The suite proves the
   control plane's half of each — the refusals, the grants, the carries, the records — with a fake
   backend. What no test can prove is that a real model, handed the new tool list, uses it: that a
   coordinator actually spawns its four reviewers and consolidates what comes back, that a spec
   agent attaches the file it wrote, that a senior dev records the sha it just pushed. One run of
   `compound-engineer-workflow` is the check, and it costs what it costs.
7. **Six smoke tasks are on the Acme board** from an earlier session's live runs ("Round five smoke",
   "Round five local smoke", "Round five local stream", "Round five cleanup proof", "Cloud path
   proof", "Vault lifecycle proof"). Two are stuck in `doing` behind the failures from the old, dead
   API key; they are left deliberately as evidence that the failure path records a provider outage
   on the session row instead of swallowing it. Delete them whenever you like.

## Projects were real everywhere except where you could see them

The founder asked which things belong to a project and which belong to AgentOS, and said they got
confused by their own software. They were right to be: the answer was correct in the database and
absent from the interface.

**What was already true.** Every domain table carries `projectId` — agents, tasks, goals, repos,
MCP connections, skills, secrets, env bindings, environments, triggers, automations, files,
sessions, inbox messages, and `project_settings` itself. `agents_project_name_key` is on
`(projectId, name)`, so two projects each get their own `senior-dev`. Every grant in `manifest.ts`
resolves with `eq(x.projectId, agent.projectId)`, so a repo or secret id belonging to another
project resolves to *nothing* rather than to someone else's credential. File rows are filtered by
project and the R2 key is `${projectId}${path}`. The isolation the founder was worried about was
never missing.

**What was missing was the whole UI.** `useActiveProject` returned `data[0]` — the first project by
creation date, forever. The comment admitted it: *"A project picker lands with YAML-as-code in
Phase 6."* Phase 6 shipped the CLI and the picker never came, so a second project created from
`agentos project create` would have been **invisible in the browser**.

**Now:** a switcher card at the top of the rail with a gear beside it, the selection held in a
module-level store (`useSyncExternalStore`, persisted to `localStorage`) rather than a context — the
shell needs the answer before the router mounts, and a provider would have left anything outside it
silently reading a default. All 34 call sites of `useProjectGate`/`useActiveProject` followed with
no edits.

**Two scopes, two pages, and the rail now says which is which.** Everything above the new hairline
belongs to the project named at the top; the "All projects" section below it does not. `/project`
(the gear) owns identity, a *What this project owns* panel that counts the eleven owned resources,
and the policy that was always per-project but read as global: default runner, parked-session
timeout, orphan sweep. `/settings` is now the installation — runner reachability, push (a property
of the browser, not a workspace), and the operator token.

**Two real bugs fell out of building it.**

1. `GET /inbox` accepted `projectId` and used it *only* to resolve a thread; the flat list ignored
   it and returned all 200 most recent messages across every project. Verified against a live
   second project: both projects reported the same ten questions. `GET /sessions` had no project
   filter at all — so the Sessions screen's spend total silently summed another project's runs.
   Both fixed in SQL, with `test/project-scope.spec.ts` covering all three cases; the test exists
   because this failure is invisible until the day a second project is created.
2. `api.updateProject` was written as `PATCH`; the controller is `PUT`. Confirmed by hand — PUT 200,
   PATCH 404 — so rename would have looked like a button that does nothing.

**Verified in a browser at 1440 and 390.** Created a real second project (`todo-app`), switched to
it and back: the board emptied, the inbox emptied, the top-bar badge cleared, and the counts on
`/project` matched the API exactly (14 agents / 50 tasks / 1 goal for `acme`, all zeros for
`todo-app`). Renamed through the form and watched the sidebar, the heading and the "Saved." feedback
all follow. No horizontal scroll at 390px. The gear went from 36px to 44px wide after measuring it
in the mobile drawer.

**The `todo-app` project is still in the dev database.** There is no delete-project endpoint, so it
stays until one exists or it is removed by hand.

## Settings stopped being a form

The founder called the two settings screens out as looking bad next to the rest of the app, and the
cause was one token. `Page width="form"` was `max-w-2xl` **without `mx-auto`** — so on a 1440px
monitor both screens rendered as a 670px strip hard against the rail with the other half of the
sheet empty. It was defensible when Settings held four fields; it stopped being defensible when
`/project` grew an eleven-row inventory and three policy panels.

Both are now two columns — `xl:grid-cols-[minmax(0,1fr)_360px]`, collapsing to one below `xl`. The
things you *set* run down the main column; reference material sits in a sticky rail beside them, so
the inventory can be read while the policy is being changed. `width="form"` is deleted rather than
left for someone to reach for again, and `DESIGN.md` records the two-column rule for configuration
screens instead of the width that caused this.

Measured: 762px + 360px used of 1190px available at 1440, one 802px column at 1100, no horizontal
scroll at 390.

**A new panel answers a question the product could not.** The founder asked whether creating a
project creates a directory on their machine. It does not, and nothing on screen said so. *Where the
code lives* now states it: a repo is a pointer to a remote plus a credential, a session clones it
into a throwaway directory, and what survives is what was pushed. It shows an amber `no repo` badge
when the project has none — which is the true state of `acme`, and the actual cause of the librarian
and implementation agents parking "no repo access" questions in the inbox. The create dialog says
the same thing in one line.

## GitHub without a personal access token

The founder pointed at Coolify's "connect your GitHub" flow and asked whether it ports. It does,
and the reason is worth stating plainly: a personal access token is long-lived and carries the
union of every scope its owner ticked, while a **GitHub App installation** mints a token that
expires in an hour and reaches only the repositories the operator selected on github.com. For a
system whose entire premise is handing credentials to a model, that is not a convenience feature.

**What was read.** Coolify's `bootstrap/helpers/github.php` and `app/Http/Controllers/Webhook/
Github.php`, including the two security fixes visible in its own history: the setup callback's
`state` is single-use and stored hashed, and the `installation_id` it carries is re-checked against
the GitHub API before it is persisted, because that callback is an unauthenticated GET whose query
string an attacker supplies.

**What was not copied.** Coolify's manifest flow has the app *generate and persist a private key*.
There is no write path into Secret Manager here and a PEM must never land in the app database
(SPEC §5.8), so the App is created once by hand and `GITHUB_APP_PRIVATE_KEY` is a providerRef like
every other credential. The operator's per-repo experience is the same either way: press Connect,
approve on github.com, pick repositories from a list.

The runtime needed **no change at all** — `apps/local-runner/src/workspace.ts` already clones with
`x-access-token` as the username, which is exactly what an installation token expects.

### Four review rounds, three of them refusals

Codex reviewed this and would not pass it until the fourth pass.

**Round 1 — High: the token could be sent anywhere.** `remoteUrl` is free text and nothing bound it
to the installation, so pairing a real installation with `https://attacker.example/x.git` made the
next session post a live token — good for every repository that installation covers — to that host.
Fixed at two doors, and while fixing it I found a **second door Codex had not flagged**:
`agentos push` upserts a repo by name and can rewrite `remoteUrl` on a row whose installation stays
put, which no create-time check would ever see. So the real fix is at the mint site in
`manifest.ts`, which every clone passes through.

**Round 2 — High again: scheme and port confusion.** The first fix compared *hosts*. Codex ran a
live probe: `http://github.com/owner/repo.git` passed as github.com, and git sent the token in
plaintext to whatever answered on port 80. `https://host:9443` and `https://host:8443` were equal
too. `remoteMatchesHost` became `remoteAcceptsInstallationToken`, comparing the whole origin —
scheme, host, port — and requiring https, because an installation token is HTTP Basic auth and an
ssh remote cannot carry one at all.

**Round 3 — High: the same bug by configuration instead of by data.** `GITHUB_API_URL` was
`z.string().url()`, which accepts `http://`, and that URL receives an `Authorization: Bearer`
header carrying the App JWT and every minted token. Both GitHub URLs now go through an `httpsUrl`
schema that fails at startup.

**Round 4 — GO.** No Critical or High. Its one remaining note was that a regression test did not
directly assert the non-numeric bracketed-IPv6 port; that test now exists.

Three smaller findings were fixed along the way: a repo bound to an installation no longer falls
back to a stored PAT when minting fails (an outage would otherwise swap an hour-long repo-scoped
credential for a long-lived account-wide one, unattended); the secret registry now evicts its
oldest entry instead of refusing new ones, which mattered the moment hourly-rotating tokens started
filling it; and repository pagination says so when it truncates.

**One divergence from git worth recording.** The parser rejects any remote containing a backslash
rather than normalising it. A browser folds `\` into `/` and reads
`https://github.com\@attacker.example/x` as host `github.com`; git reads the same string as
userinfo on host `attacker.example`. Agreeing with either one is a guess, and guessing wrong hands
the token to the host git actually dials. No legitimate remote contains a backslash.

## Deleting things, and installing them

Two gaps the founder hit within an hour of using their own software.

**Nothing could be deleted.** Only files, secrets, tasks and GitHub installations had a DELETE.
Agents, repos, MCP connections, environments, skills, triggers, automations, templates, goals,
sessions and projects could be created and never removed — the first typo was permanent. All of
them now can be, from the UI.

The interesting part is what deletion has to clean up. An agent holds its grants as **jsonb**
(`repoAccess`, `mcpConnectionIds`, `skillIds`, `collaborationList`), which the database cannot
cascade through, so `deletion.service.ts` strips each reference in the same transaction. Nothing
insecure followed from a stale id — `manifest.ts` resolves by `(id, projectId)` and a missing row
resolves to nothing — but an agent screen listing a repository that is gone tells the operator
something untrue about what that agent can reach.

**A new project was fourteen forms from being usable.** `ROLE_SEEDS` was the agent library all
along, reachable only from `pnpm db:seed`. `builtInRoleInstalls()` moved it into
`@agentos/shared` so the seed and the new install endpoint cannot drift, and both Agents and Skills
now have an "Install built-ins" button.

### Six review rounds, five of them refusals

This is the longest review the project has run, and it earned it: every round found something real,
and **three of the findings were regressions in the previous round's fix.**

| Round | What it found |
|---|---|
| 5 | 4 High: project deletion stranding live containers; leaving R2 objects; the installer overwriting a collaboration list; a transaction that opened `tx` and then issued both statements on `this.db` |
| 6 | 4 High: terminal status ≠ container destroyed; **the file deletion I had just added ran before the locked recheck, so a refused deletion destroyed the files**; provenance-by-name overwriting an operator's own agent; the goal-dispatch race |
| 7 | `runtime_released_at` still falsely released a live runtime — the backfill guessed, and `VaultCleanup` set it after deleting vaults only |
| 8 | **The maintenance reaper never marked release**, so every session it finished became permanently undeletable — my regression |
| 9 | The unpersisted-handle window: `provision()` returns a live container and the row records it a statement later |
| 10 | **My fix put handle persistence inside the fallback catch**, so a failed database write sent the session to the cloud while the live local container stayed unrecorded — and `destroyQuietly` swallowed the destroy failure, so it claimed a container was gone when it was not |
| 11 | **GO** |

**What actually changed as a result.** Deletion refuses while anything is live *or* holds
credentials *or* has a runtime never confirmed destroyed. `runtime_released_at` is written in
exactly two places, both immediately after `runner.destroy()` returns. `agents.built_in` is a real
provenance column, and migration 0017 deliberately backfills **nothing** — two predicates were
tried and both were unsound, and a name is not provenance. The handle is now persisted the instant
it exists, and a runtime that can be neither recorded nor destroyed is written down anyway, because
a row that names an orphan is the difference between one the operator can find and one they cannot.

**The escape hatch.** `DELETE /sessions/:id?force=true` exists because some rows can never satisfy
the guard — anything predating the column. It refuses by default, names the runtime in the refusal,
and logs a warning when forced. Project deletion has no force.

**Known and accepted.** An operator who pauses a goal and deletes it in the same second, while an
iteration is mid-dispatch, can still produce a session for a goal that is gone; the orchestrator
re-checks immediately before creating the container, which narrows it to a window the operator has
to race deliberately. The reviewer agreed this is not a deployment blocker for a single operator.

## Next session

The nine gaps are closed and every wall around them has a test. What is left is the part a coding
agent cannot sign off.

**The founder's hour.** A real visual pass (`RECIPE.md` A1.6) — the file browser, the attachments
on a card, and the goal's shared thread are new surfaces nobody has looked at — one click on
"enable notifications" to close the push path, and **one live run of the feature template**, which
is the only thing that proves the new tools are usable by a real model rather than merely present.

**Watch what the local runner costs you while you do it.** It is configured on the founder's
machine and `auto` routing prefers it; that is exactly how the test suite came to spend a
subscription for fifty minutes at a time.

**Set `GLITCHTIP_DSN`** when the stack goes up, or the reporting above stays in the log where the
two incidents that motivated it went unnoticed.

**On whether to run an eighth.** The trend, not the count, is the thing to read. Rounds one to six
each found real defects in the previous round's fixes; round seven cleared the mechanism it was
pointed at and fell from five High to three, and its three blockers were narrow boundary conditions
(a retained BullMQ id, a lease a resumed turn did not take, a credential shape nobody had listed)
rather than design faults. An eighth round would probably still find something — it always has — but
the honest read is that this is now the tail, not the body. If you run one, scope it to round
seven's three fixes and stop when it comes back Medium and Low.
