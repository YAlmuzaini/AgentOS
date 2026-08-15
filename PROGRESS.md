# PROGRESS.md — living state

Update every session. Read on boot alongside `RECIPE.md`, `PRODUCT.md`, `SPEC.md`, `DESIGN.md`.

**Last updated:** 2026-08-15

---

## Where we are

**All eight phases of `SPEC.md` §21 are built, and agents now actually run.** 109 automated tests
pass, and the cloud runner, the network wall, the inbox pause/resume cycle, vault cleanup, the
local runner and its credential proxy have each been exercised against real containers. Six
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

## Verified this session

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
6. **Six smoke tasks are on the Acme board** from this session's live runs ("Round five smoke",
   "Round five local smoke", "Round five local stream", "Round five cleanup proof", "Cloud path
   proof", "Vault lifecycle proof"). Two are stuck in `doing` behind the failures from the old, dead
   API key; they are left deliberately as evidence that the failure path records a provider outage
   on the session row instead of swallowing it. Delete them whenever you like.

## Next session

The ops gap is closed and both runners are verified on this build, so what is left is short.

**The founder's hour.** A real visual pass (`RECIPE.md` A1.6) and one click on "enable
notifications" to close the push path. Neither is something a coding agent can honestly sign off.

**Set `GLITCHTIP_DSN`** when the stack goes up, or the reporting above stays in the log where the
two incidents that motivated it went unnoticed.

**On whether to run an eighth.** The trend, not the count, is the thing to read. Rounds one to six
each found real defects in the previous round's fixes; round seven cleared the mechanism it was
pointed at and fell from five High to three, and its three blockers were narrow boundary conditions
(a retained BullMQ id, a lease a resumed turn did not take, a credential shape nobody had listed)
rather than design faults. An eighth round would probably still find something — it always has — but
the honest read is that this is now the tail, not the body. If you run one, scope it to round
seven's three fixes and stop when it comes back Medium and Low.
