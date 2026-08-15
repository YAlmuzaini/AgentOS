# PROGRESS.md — living state

Update every session. Read on boot alongside `RECIPE.md`, `PRODUCT.md`, `SPEC.md`, `DESIGN.md`.

**Last updated:** 2026-08-14

---

## Where we are

**All eight phases of `SPEC.md` §21 are built, and agents now actually run.** 77 automated tests
pass, and the cloud runner, the network wall, the inbox pause/resume cycle, vault cleanup, the
local runner and its credential proxy have each been exercised against real containers. Total spend
proving it: about $0.50.

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

Automated (`pnpm --filter @agentos/api test`, 77 tests, 11 suites):

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
4. **Two review rounds, two refusals, and a third in flight.** Each round found real defects in the
   previous round's fixes — including one, the invalid BullMQ job id, that would have wedged every
   template chain in production. Treat "the tests pass" as the weakest of the available signals
   here; the concurrency and cleanup paths have been rewritten twice and reviewed once each.
5. **`.env.example` line 9 was twice found holding a real token.** The founder confirmed that was
   their own doing, not a stray process. Blank now; worth a glance before the first commit.

## Next session

The credential is in and the first runs are done. The honest next step is the ops layer from
`RECIPE.md` A8 — GlitchTip first, because the runner fails in ways nobody will be watching for, and
this session proved the point: a broken orphan sweep logged an error into a terminal nobody reads.
