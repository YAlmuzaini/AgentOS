# PRODUCT.md — AgentOS

## What

A single-operator **AgentOS**: a control plane + UI on top of the Claude Agent SDK. The operator files
a task or a goal, assigns a scoped agent, and walks away. Agents run in ephemeral containers, do the
work (spec → plan → review → implement → commit), and only interrupt the human through an Inbox when
they are stuck or need a decision.

Full contract: `SPEC.md`. Engineering contract: `RECIPE.md`. Live state: `PROGRESS.md`.

## For whom

One person: the founder. **Not** a multi-tenant SaaS. `RECIPE.md` Part B does not apply — no orgs, no
RBAC ladder, no billing, no tenant choke point. Single operator, one identity, personal access tokens
for the CLI and runners.

## The four primitives

| Primitive | What it is |
|---|---|
| **Project** | Unit of YAML-as-code. Declares agents, skills, templates, MCP connections, repos. |
| **Task** | Kanban card (`todo`/`doing`/`review`/`done`) with an assignee agent, schedule, approval gate, chain position. |
| **Goal** | Open-ended loop. Orchestrator spawns specialists until a human-approved Definition of Done is fully checked, or a spend/time/stuck rail trips. |
| **Session** | One containerized agent run. Born empty, initialized, executed, committed, destroyed. |

## The non-negotiable properties

These are the product, not implementation details. Everything else is negotiable.

1. **Least privilege, default deny.** An agent gets no MCP, repo, env var, filesystem write, network
   host, or spawn right that is not explicitly listed on it. Enforced at four independent walls: MCP
   grant, network allowlist, filesystem ACL, repo access.
2. **Ephemeral sessions.** Containers are destroyed after every run. Nothing survives except git
   commits and files written through the filesystem MCP. No warm workspaces.
3. **Approval gates are enforced server-side.** An agent session token can never `PATCH status=done`
   on a gated task. 403, not honor system.
4. **Inbox is the only human channel.** No Slack, no email, no second chat product.
5. **Goals have rails.** Spend cap, max duration, stuck-at-19. A goal without a spend cap requires
   explicit human confirmation.

## Monetization

**None.** `RECIPE.md` A3 asks for a model; the honest answer for this product is that it is internal
tooling for one operator. No billing machinery, no plan catalog, no entitlements. If it is ever sold,
that is a different product and a different `PRODUCT.md`.

## Deliberate deviations from `RECIPE.md`

| RECIPE rule | Status here | Why |
|---|---|---|
| A1.6 no browser-automation tests | Holds for **our** UI. | The E2E step inside `compound-engineer-workflow` is a *product feature* that runs the managed repo's own E2E — not our test suite. We add no Playwright/Cypress to this repo. |
| A3 monetization | N/A | Internal single-operator tool. Stated, not skipped silently. |
| Part B multi-tenancy | Skipped entirely | Not multi-tenant SaaS. |
| A7 stack | **Binding**, overrides `SPEC.md` §3.4 | §3.4 self-labels as an assumption. NestJS + Drizzle + pnpm/Turborepo + BullMQ wins. |

## Stack (RECIPE A7)

pnpm workspaces + Turborepo · `packages/shared` (Zod contracts) · `packages/db` (Drizzle + Postgres) ·
`apps/api` (NestJS, Clean Architecture) · `apps/web` (Vite + React + TanStack Router/Query + Tailwind +
shadcn/ui) · `apps/cli` (`agentos`) · BullMQ + Redis for schedules and session queues · Better Auth
(single operator) · S3-compatible object storage (MinIO local, R2 prod) behind a provider interface.

## Not building

- Multi-user, teams, orgs, billing.
- A from-scratch agent runtime. The SDK is the runtime; local VM is a second backend behind the same
  `Runner` interface.
- Extra agent roles, extra template steps, or UI beyond `SPEC.md` §18.
- Persisted containers "to save time."
