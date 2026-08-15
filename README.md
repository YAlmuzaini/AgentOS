# AgentOS

You define agents (plan, senior-dev, …) with only the tools they need. You file a task or a goal.
AgentOS starts a throwaway container, clones the allowed repo, injects allowed secrets, and lets that
agent work. When it needs you, you get an inbox push. When it's done, the container is gone and a
commit or a PR is left behind. Recurring jobs and webhooks use the same path.

A feature template runs spec (you approve) → plan → four-lens plan review → revise → implement with
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
| `agentos.yml` | This project as code |

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
backend — `apps/local-runner`, a worker on a VM you own running Claude Code — sits behind the same
`Runner` interface. It is cheaper on a subscription and weaker on isolation; `DEPLOY.md` §6 is
blunt about which trade you are making.

## Running it locally

```sh
cp .env.example .env
# fill in AGENTOS_OPERATOR_TOKEN (openssl rand -hex 32) and an Anthropic credential
pnpm install
pnpm infra:up          # postgres :5433, redis :6380, minio :9000
pnpm db:migrate
pnpm db:seed           # one project, 14 role agents, 2 environments, 2 templates
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
pnpm --filter @agentos/api test
```

77 tests covering all fourteen acceptance tests in `SPEC.md` §22. They run against a real Postgres
and a `FakeRunner` that implements the `Runner` contract, so the whole control plane — gates,
grants, chains, rails, webhooks, resume — is exercised **without an Anthropic credential and without
spending anything**. What they do not prove is that a real container behaves; see `PROGRESS.md`.

## CLI

```sh
export AGENTOS_OPERATOR_TOKEN=…
pnpm --filter @agentos/cli dev help

agentos pull                       # write the project to agentos.yml
agentos push                       # apply the file; reports created/updated/unchanged
agentos task create --project acme --name "Fix login" --agent senior-dev
agentos goal create --project acme --title "Ship onboarding" --spec-file spec.md --cap 25
agentos template run --project acme --template compound-engineer-workflow \
  --var branchName=feat/onboarding --var feature="operator onboarding"
```

`push` then `pull` is byte-identical, which is what makes `agentos.yml` safe to keep in git.

## The five properties that are the product

1. **Least privilege, default deny.** An agent gets no MCP, repo, env var, filesystem write, network
   host, or spawn right that is not listed on it. Four independent walls.
2. **Ephemeral sessions.** The container is destroyed on every exit path. The one exception is a
   session parked on an inbox question — it survives until you answer, or until the timeout you set
   in Settings (24 hours by default) gives up on you.
3. **Approval gates are server-side.** An agent can move a gated card to review and can never close
   it. Nothing downstream of a gate runs until you do.
4. **Inbox is the only human channel.** No Slack, no email, no second chat product.
5. **Goals have rails.** Spend cap, max duration, stuck-at-19 — checked before every dispatch and
   again after. A goal without a spend cap needs explicit confirmation.

## Conventions

- Commits are user-gated: nothing is committed or pushed without you asking.
- Secrets live in env only, referenced by name, never in the app database.
- Files stay under 300 lines; extract rather than bloat.
- Agent prompts are **reconstructed**, not the originals, and every prompt file says so.
