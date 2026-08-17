# AgentOS

You define agents (plan, senior-dev, …) with only the tools they need. You file a task or a goal.
AgentOS starts a throwaway container, clones the allowed repo, injects allowed secrets, and lets that
agent work. When it needs you, you get an inbox push. When it's done, the container is gone and a
commit or a PR is left behind. Recurring jobs and webhooks use the same path.

A reusable company profile prepares the fleet, resource slots and workflows; preflight proves the
project can run before anything is dispatched. A feature template runs spec (you approve) → plan → four-lens plan review → revise → implement with
E2E → code review → fixes → wiki → you merge. A goal loop keeps dispatching specialists until the
definition of done is checked, or the spend, time, or stuck rail stops it.

Single operator. Not a SaaS.

| Document | What it is |
|---|---|
| `PRODUCT.md` | What this is and for whom |
| `SPEC.md` | The full contract, reconstructed from the source talk |
| `DESIGN.md` | The visual system the UI implements |
| `PROGRESS.md` | Where the build actually is, including what is unverified |
| `DEPLOY.md` | Shipping it |
| `RECIPE.md` | The founder's engineering contract |
| `agentos.yml` | This project as code, including provenance, company profiles and resource slots |

## Layout

```
apps/api          NestJS control plane + queue worker (Clean Architecture)
apps/web          Vite + React + TanStack Router/Query operator UI and PWA
apps/cli          `agentos` — CLI against the control-plane API
packages/db       Drizzle schema, migrations, seed
packages/shared   Zod contracts, enums, reconstructed agent prompts, templates
```

**The runtime is Anthropic Managed Agents.** Anthropic runs the agent loop and the per-session
sandbox; AgentOS owns policy, tasks, goals, the inbox, and the record of what happened. A second
backend — `apps/local-runner`, a worker on a VM you own — sits behind the same `Runner` interface
and runs either Claude Code or Grok in yolo mode. It is cheaper on a subscription and weaker on
isolation; `DEPLOY.md` §6 is blunt about which trade you are making.

## What an agent can do inside a session

Its whole toolset, and every one of them is granted rather than assumed:

| Tool | What it is for |
|---|---|
| `agentos_update_task` · `agentos_add_activity` | Move the card, record what happened |
| `agentos_attach_file` | Attach a file it wrote, so the next step and every collaborator inherit it |
| `agentos_record_commit` · `agentos_create_handoff` | Record durable commits and a scoped work product before the container is destroyed |
| `agentos_spawn_collaborators` · `agentos_read_subtask` | Spawn agents **on its collaboration list only**, in parallel, and read their reports |
| `inbox_send` · `inbox_ask` · `inbox_read` | The only channel to you. `ask` carries up to four questions at once, so an agent that needs three decisions parks once rather than three times |
| `fs_list` · `fs_read` · `fs_write` · `fs_mkdir` · `fs_delete` | The persistent filesystem, per-folder and per-verb |

An agent with no collaboration list has no spawn tool at all; one with no `git-write` grant has no
commit tool; one without inbox access has no inbox tools. Absent capability, not a refused call.

## Running it locally

```sh
cp .env.example .env
# fill in AGENTOS_OPERATOR_TOKEN (openssl rand -hex 32) and an Anthropic credential
pnpm install
pnpm infra:up          # postgres :5433, redis :6380, minio :9000
pnpm db:migrate
pnpm db:seed           # one project, 37 agents, 20 skills, 2 environments, 2 templates
pnpm --filter @agentos/api dev     # :3001
pnpm --filter @agentos/web dev     # :5173
```

The web app asks for `AGENTOS_OPERATOR_TOKEN` on first load and keeps it in that browser only.

### Anthropic credentials

The cloud runner resolves credentials the way every Anthropic SDK does: `ANTHROPIC_API_KEY`, then
`ANTHROPIC_AUTH_TOKEN`, then an `ant auth login` profile. Leave `ANTHROPIC_API_KEY` blank in `.env`
if you use a profile. **Without one, sessions fail immediately** and the error is recorded on the
session row — the rest of the pipeline still runs, which is how the test suite works.

## Smoke test

```sh
TOKEN=$(grep '^AGENTOS_OPERATOR_TOKEN' .env | cut -d= -f2)
PID=$(curl -s -H "authorization: Bearer $TOKEN" localhost:3001/projects | jq -r '.[0].id')
AID=$(curl -s -H "authorization: Bearer $TOKEN" localhost:3001/projects/$PID/agents \
      | jq -r '.[] | select(.name=="default") | .id')

curl -s -X POST -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d "{\"name\":\"Smoke test\",\"description\":\"Say hello, then mark the task done.\",\"assigneeAgentId\":\"$AID\"}" \
  localhost:3001/projects/$PID/tasks

curl -s -H "authorization: Bearer $TOKEN" localhost:3001/sessions | jq '.[0] | {status, error, traceUrl}'
```

It passes when the task reaches `done`, the session reaches `destroyed`, and the session's
`toolCallLog` shows the agent's tool calls.

## Tests

```sh
pnpm test                                 # every suite
pnpm --filter @agentos/api test           # control plane
pnpm --filter @agentos/local-runner test  # the worker's egress wall and Grok engine
pnpm --filter @agentos/cli test           # the CLI's capability flags
```

312 control-plane tests, 54 worker tests and 4 CLI tests, covering the original fourteen acceptance tests in `SPEC.md`
§22. The control-plane suite runs against a real Postgres
and a `FakeRunner` that implements the `Runner` contract, so the whole control plane — gates,
grants, chains, rails, webhooks, resume, spawning, attachments, commits — is exercised **without an
Anthropic credential and without spending anything**. The harness blanks `LOCAL_RUNNER_URL` for
exactly that reason: with a worker running on your machine, the router would happily send the suite
to it and bill a real subscription. What the suite does not prove is that a real container behaves;
see `PROGRESS.md`.

## CLI

```sh
export AGENTOS_OPERATOR_TOKEN=…
pnpm --filter @agentos/cli dev help

agentos pull                       # write the project to agentos.yml
agentos push                       # apply the file; reports created/updated/unchanged
agentos task create --project acme --name "Fix login" --agent senior-dev
agentos goal create --project acme --title "Ship onboarding" --spec-file spec.md --cap 25
agentos agent create --project acme --agent triage --title "Triage" --model claude-sonnet-5 \
  --prompt-file prompts/triage.md --runner local --inbox   # or --no-inbox; it is not assumed
agentos agent update --project acme --agent review-coordinator \
  --collaborators feasibility,scope-guardian,coherence,plan-risk
agentos skill create --project acme --slug lint --name Lint --kind file --file-path /skills/lint.py
agentos template run --project acme --template compound-engineer-workflow \
  --var branchName=feat/onboarding --var feature="operator onboarding"
```

`pull` → `push` → `pull` is byte-identical, which is what makes `agentos.yml` safe to keep in git.
Note the starting point: `pull` renders the document from the database with sorted keys, so pushing
a **hand-written** file and pulling it back returns the same *content*, not the same bytes — your
comments, key order and omitted defaults are not preserved. Keep the pulled form in git.

## What ships in the box

A new project is a library to pick from rather than an empty screen. Everything below installs
**inert**: an agent with no grants, a skill attached to nobody, a connection no agent may call.

| | Count | Installed by |
|---|---|---|
| **Agents** | 37 across 13 categories | `POST /projects/:id/agents/install-built-ins`, or a pack |
| **Packs** | 8 named subsets | `POST /projects/:id/agents/packs/:slug/install` |
| **Skills** | 20 prompt skills | `POST /projects/:id/skills/install-built-ins` |
| **MCP connections** | 8 installed, 3 more catalogued | `POST /projects/:id/mcp-connections/install-built-ins` |
| **Templates** | 2 workflows | `POST /projects/:id/templates/install-built-ins` |

Thirty-seven agents is a good library and a bad starting screen, so a **pack** installs a named
subset — core engineering, frontend/design, data & RAG, DevOps/release, research/docs,
product/content, operations/support, mobile. Packs overlap and installing twice is a no-op.

### Recommendation is not a grant

Twenty roles carry a **recommended skill list** — `senior-dev` gets commit discipline, the
verification loop, no-fake-completion and change hygiene; `db-architect` gets schema-change safety.
Those are applied when a built-in agent is created. Installation order does not matter: if the
agent arrives first, it remains explicitly pending and later built-in skill installation merges the
recommendations that have become available. Once all recommendations were initialized—or the
operator edits the skill list, including intentionally making it empty—the installer never manages
that list again. Reinstalling an agent does not restore a removed skill. An operator-authored agent
that collides with a built-in name, and a built-in with an operator-curated non-empty list, are both
preserved.

Nothing that reaches outside AgentOS is granted by installing: no repository, MCP connection,
filesystem folder, secret, environment, or network access. Two things a *newly created* agent does
arrive with, both visible on the agent and neither restored once you remove them: its recommended
prompt skills, and — for a coordinator — the collaboration list its job is defined by, which is
spawn authorisation over other agents that have no grants either.

### The five words this UI keeps apart

| Word | Means |
|---|---|
| **cataloged** | AgentOS ships this URL, and has declared its transport, auth and risks from the vendor's docs |
| **configured** | A row exists in this project — possibly with no credential |
| **granted** | At least one agent lists it, so a session can reach it |
| **network-reachable** | The environment's allowlist permits its hosts |
| **live-verified** | A real MCP handshake succeeded from here — `initialize` and `tools/list` |

Only the last is evidence. Verification is **opt-in and operator-triggered** (`POST
/projects/:id/mcp-connections/:id/verify`): it performs the handshake, records the server identity
and the tool names it reported, and **never calls a tool** — a catalogued server can charge money,
issue a refund, or open a pull request.

### MCP: what this can and cannot carry

**Every shipped connection is a remote server over HTTPS with a static bearer token or no auth.**
That is not a shortlist; it is the whole of what both runners speak. The cloud path publishes
`auth: { type: "static_bearer", mcp_server_url, token }` to Managed Agents; the local path builds an
`http` server for the SDK. So:

- **No stdio.** A `npx`-launched server cannot be expressed at all, which excludes most of the
  published ecosystem.
- **No OAuth.** Linear, Notion, Sentry, Atlassian and Asana publish remote endpoints that need an
  authorisation-code flow, so they are absent rather than listed and broken.
- **No per-tool filtering on the local runner.** Claude Code attaches an MCP server whole. A
  connection with a non-empty `allowedOperations` is therefore **refused** by the local worker
  rather than silently widened, and the omission is reported in the session log. The cloud runner
  does enforce the list per tool. A connection with an *empty* list gives a local session **every
  tool the server exposes** — the MCPs screen says so on the row.

Defaults are chosen, not copied: GitHub defaults to the documented **`/readonly`** endpoint, and
Apify to `?tools=docs&telemetry-enabled=false` because its default tool set can execute Actors,
which is billed to you. The read/write GitHub endpoint, Apify Actor execution, and Stripe are
catalogued and **not installed** — one click away, with their risks labelled.

### What is best-effort, and what is a boundary

Two things in this system are **guarantees**, enforced server-side and tested: least privilege
(nothing is granted that is not listed) and local-only cost (an explicit `local` never reaches the
cloud). Two are **best-effort**, and `PROGRESS.md` says exactly why:

- **Credential redaction in stored text.** Removed by exact-value matching at the points where text
  becomes a row. The registry is global, bounded, and ignores values under eight characters, so
  treat a session log as sensitive rather than sanitised.
- **Detecting a credential inside a URL.** Userinfo over http(s) is refused, and query parameters
  named like credentials are refused; a key in a path segment is not detectable. Put credentials in
  a secret reference.

### Skills are inlined, not progressively disclosed

A skill's body is injected into the system prompt of **every session that holds it**. AgentOS does
not implement Anthropic's `SKILL.md` progressive disclosure, so there is no "loads only when
triggered" here — which is why every shipped skill is short, and why a long one belongs on the agent
filesystem as a `file` skill whose path the agent reads on demand.

## Preparing a project as a company

Project setup is a deliberate seven-step path: create the project, connect/select a GitHub
repository, choose one of seven company profiles, choose Local/VPS, Cloud or Hybrid (`auto`),
resolve resource slots, run fleet preflight, and act on the ready/blocker report. Profiles cover
full-stack, frontend, backend/API, data/RAG, DevOps/infrastructure, mobile and minimal engineering.

A profile preview lists exactly what will be created and what existing rows will be preserved.
Applying it installs only missing inert agents, skills, pack records and workflow templates. It does
not grant a repository, credential, MCP, folder or network policy, and reinstalling never overwrites
project customization. Profile and pack versions and provenance are persisted and round-trip in
`agentos.yml`.

Preflight is one service shared by project setup, template dispatch and goal activation, and the
question it asks depends on whether the execution graph is known.

A **workflow** names the exact roles its steps dispatch to, so every one of those roles must itself
hold the required repository, environment and connections. A **project or goal** has no fixed graph,
so the test is that a capable worker exists at all: at least one ready, eligible agent per required
resource. That distinction is the point of the whole feature — a fleet where the support agent
holds nothing and one implementer holds the production repository is a *passing* fleet, not a
blocked one. Verified against a running server: a 37-agent project in which exactly one agent is
granted the required repo and environment passes preflight, and the other 36 are reported as
deliberately ineligible rather than as errors.

It also checks recommended capabilities, authorized collaborators, MCP configuration and
verification, workflow inputs, explicit human gates, runner compatibility and local-worker
readiness. Errors block on the server. Warnings require an explicit acknowledgement — the operator
sees every warning and ticks a box; no screen sends that acknowledgement on their behalf. Reports
contain no credential values, and failed checks are retained for the executive briefing.

Every installed agent, skill, MCP connection, pack, company profile and workflow carries structured
provenance: relationship (`original`, `imported`, `adapted`, `inspired`), source/repository paths and
versions where applicable, immutable commit and license metadata when known, content hash, check
timestamps and attribution notes. AgentOS never auto-updates installed prompts from upstream. The
RAG architect and RAG skills are original AgentOS prompts marked **inspired** by research—not copied
from MCP Market or `sickn33/agentic-awesome-skills`.

Goal routing uses bounded capability cards, not prompt bodies: role identity, skill slugs, repo/MCP
grants, environment posture, runner compatibility, collaboration list and concrete readiness
reasons. The eligible roster is computed from the *same* resolved requirements preflight uses and
bounded once, so the prompt, the audit row and the server-side rejection all read one identical
list — an agent lacking the goal's required repository is never offered and never accepted. Goal decisions are routed too: explicit `local` goes to the worker's own decision
endpoint and the control plane never calls the Anthropic API for it; `cloud` uses the metered API;
only `auto` may choose cloud when local is not ready. Backend, provider, model, eligible/selected
role names, duration and a prompt hash—not the prompt or secrets—are retained for audit.

**One honest caveat about what `local` costs.** Routing is about *where the request goes*, not about
what it is billed as, and the worker holds its own credential. Configure the worker with a Claude
Code subscription OAuth token and local work is flat-fee, which is the point of it. Configure it
with an `ANTHROPIC_API_KEY` — a supported worker setup — and the *worker* bills per token for the
same run. AgentOS does not hide this: the worker reports its billing mode, sessions and decisions
record `subscription`, `metered-api` or `unknown`, and the executive briefing counts local metered
sessions separately from local subscription ones. A runner named `local` is never presented as proof
of subscription billing.

Parallel goal work is bounded orchestrator fan-out, not recursive peer chat. Up to four specialists
in a turn share the goal deadline and cancellation signal, reserve iterations before provisioning,
split the remaining budget, and persist goal-scoped handoffs. A handoff records outcome, evidence,
verification, files, commits/branch, risks, blockers, decisions and the authorized next role. It is
durable project/task/goal data. Every field and array has an explicit size limit, at most three
records are rendered, and the whole projection is capped — a record too large is *trimmed*, never
dropped, so an oversized handoff shortens rather than silently disappearing. It reaches the
recipient on the first **user** turn inside a labelled untrusted-data fence, and never in the
system prompt, which is the one layer only the operator controls.

The dashboard's executive briefing is deterministic. It groups operator decisions, stopped goals,
failed preflights/decisions/sessions/publishes, unusually long work, review-ready and completed work,
and active goals that can continue. It reports cloud cost plus local worker sessions by confirmed
subscription, metered-API or unknown billing mode; runner name alone is never presented as proof of
subscription billing.

## The five properties that are the product

0. **Local means local.** An agent, goal, or project set to the `local` runner is never sent to
   the cloud. Cloud sessions are billed per token, so an unreachable worker — or one you have put
   into drain — **fails the session with an explanation** rather than quietly spending money nobody
   is watching. `auto` is the only setting that falls back, and it says so. The failure is recorded
   as a session row, not just a log line. What `local` does *not* promise is a price: that depends
   on the credential the worker holds, and the billing mode is reported rather than assumed.

1. **Least privilege, default deny.** An agent gets no MCP, repo, env var, filesystem write, network
   host, or spawn right that is not listed on it. Four independent walls, and the spawn list is the
   only path by which one agent starts another.
2. **Ephemeral sessions.** The container is destroyed on every exit path. The one exception is a
   session parked on an inbox question — it survives until you answer, or until the timeout you set
   in Settings (24 hours by default) gives up on you.
3. **Approval gates are server-side.** An agent can move a gated card to review and can never close
   it. Nothing downstream of a gate runs until you do.
4. **Inbox is the only human channel.** No Slack, no email, no second chat product.
5. **Goals have rails.** Spend cap, max duration, stuck-at-19 — checked before every dispatch and
   again after. A goal without a spend cap needs explicit confirmation.

### Local git durability

The local worker clones with a short-lived credential and then **strips the token from the remote**,
so the agent never holds one. That used to mean a local `git-write` session committed into a
directory that was then deleted. It now doesn't: after the run ends, the **worker** pushes with the
credential it kept, to the **granted** remote rather than whatever `origin` says — an agent with a
shell can repoint `origin`, and following it would be an exfiltration primitive. Fast-forward only,
never a force, `git-write` grants only, and the token reaches git through the child's environment
rather than argv — the clone does the same, so no credential is written into `.git/config` either.

If a push fails, the workspace is **retained** rather than deleted, moved out of the swept
`session-` namespace, and the session row records where — losing the only copy of three hours of
work is the worse failure by a wide margin. The same holds when the worker cannot be reached to ask:
teardown leaves the container alone rather than destroying on an unconfirmed push. The worker also
publishes on its own hard timeout, when a parked session is reaped, and when an orphaned container
is archived; its boot sweep keeps, rather than deletes, any leftover workspace that still holds
commits no remote has.

**The gap that remains** is narrower than it was. A worker restart between the run ending and the
push no longer loses ordinary commits: the boot sweep inspects each leftover workspace and keeps,
rather than deletes, any that still holds commits no remote has — including a commit reachable only
from a detached `HEAD`, and including any workspace whose git metadata it cannot read at all, which
is judged pessimistically on purpose. A retained workspace is kept for `LOCAL_RUNNER_QUARANTINE_DAYS`
(14 by default, `0` to keep forever), timed from the moment it was set aside.

Two pieces are **not** built, and both are stated here rather than implied away. First, worker-side
persistence of *pending publishes*, so a restart resumes the push instead of leaving it for a human;
pushing mid-run would need the credential closer to the agent, which is exactly what this design
avoids. Second, the check-then-delete window: the worker signals cancellation but cannot wait for a
shell subprocess it did not spawn, so a commit completing between the final check and the delete is
still lost. Closing that needs the worker to own the agent's process group and reap it before
teardown — a change to how sessions are started, not to how they are cleaned up.

## Conventions

- Commits are user-gated: nothing is committed or pushed without you asking.
- Secrets live in env only, referenced by name, never in the app database.
- Files stay under 300 lines; extract rather than bloat.
- Agent prompts are **reconstructed**, not the originals, and every prompt file says so.
