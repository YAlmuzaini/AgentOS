# DEPLOY.md — shipping AgentOS

Self-hosted on DigitalOcean via Coolify (`RECIPE.md` A8). One stack, two public
services, everything else private.

```
app.<domain>   → web   (nginx, static)
api.<domain>   → api   (NestJS control plane + queue worker)
postgres, redis        (private network only, never published)
```

## 1. What Coolify does for you

Five things are generated or assigned by Coolify rather than configured by you,
because every one of them is a value that has to match in two places and drifts
the moment it does not:

| Coolify supplies | Used as | Why not by hand |
|---|---|---|
| `SERVICE_FQDN_API_3001` | the API's domain, proxied to port 3001 | Declaring it is what creates the route |
| `SERVICE_FQDN_WEB_80` | the web app's domain | Same |
| `SERVICE_URL_API_3001` | `PUBLIC_URL` and the web bundle's `VITE_API_URL` | This is the origin agents hand out as their webhook URL; a stale copy sends webhooks nowhere |
| `SERVICE_URL_WEB_80` | `WEB_ORIGIN`, the CORS allow-list | A stale copy is a browser that cannot call its own API |
| `SERVICE_USER_POSTGRES` / `SERVICE_PASSWORD_POSTGRES` | the database credential, in both `postgres` and `api` | One value, one place |
| `SERVICE_HEX_64_OPERATOR` | `AGENTOS_OPERATOR_TOKEN` — **your login** | Read it from the Coolify UI after the first deploy |
| `SERVICE_HEX_64_WEBHOOK` | `WEBHOOK_MASTER_SECRET` | Keeps webhook keys independent of your login, so rotating one never breaks the other |

Generated values are stable across deploys, so redeploying does not log you out
or invalidate a webhook.

## 2. What you set yourself

Create a **Docker Compose** resource pointing at `docker-compose.prod.yml` and
set these. The first five are marked required in the compose file with `${VAR:?}`
— a missing one fails the deploy with a red field instead of booting a stack
that cannot run an agent or write a file:

| Variable | Notes |
|---|---|
| `ANTHROPIC_API_KEY` | **Required.** The cloud runner's credential |
| `S3_ENDPOINT` / `S3_BUCKET` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | **Required.** Cloudflare R2, for the agent filesystem |
| `ANTHROPIC_WORKSPACE` | Workspace slug, for Console trace links. Defaults to `default` |
| `S3_REGION` | Defaults to `auto`, which is what R2 wants |
| `SECRETS_PROVIDER` / `GCP_PROJECT_ID` | `gcp` resolves secret references through Google Secret Manager instead of this process's environment. See §2.1 |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web Push. Unset disables push cleanly rather than breaking it. Generate with `npx web-push generate-vapid-keys` |
| `LOCAL_RUNNER_URL` / `LOCAL_RUNNER_TOKEN` | Optional second backend, off unless set. Read §6 first |
| `VITE_API_URL` | Only if the built bundle points at the wrong origin — see the note in the compose file |

Assign a domain to `api` and to `web`. Leave `postgres` and `redis` without one:
they are reached over the private network, and nothing in this file publishes a
port.

### 2.1 Secrets in production

A `SecretRef` in the database is a **name**, never a value (SPEC §4). Which
backend that name is resolved against is one variable:

```
SECRETS_PROVIDER=env     # development: the reference is an environment variable
SECRETS_PROVIDER=gcp     # production: the reference is a Secret Manager resource
GCP_PROJECT_ID=acme-prod # so a bare name resolves to projects/acme-prod/secrets/<name>/versions/latest
```

On `gcp`, a reference may also be a full path (`projects/p/secrets/s`, or one
pinned to `/versions/7`). Google's own auth applies — a service account on the
instance, or `GOOGLE_APPLICATION_CREDENTIALS` — and AgentOS never stores that
credential. A secret that cannot be read resolves to null: the session refuses
the grant that needed it and says which one, rather than starting an agent that
is quietly missing its token.

The point of `gcp` is the failure you hope never happens: a stolen database
yields resource names, which decrypt nothing.

## 3. Storage, health, and what survives a redeploy

Two named volumes hold everything irreplaceable, and Coolify treats named
volumes as persistent storage — a redeploy replaces containers and leaves these
alone:

- `agentos_pg` → `/var/lib/postgresql`. The Postgres 18 image wants the whole
  directory mounted, not `/var/lib/postgresql/data`; mounting the inner path
  makes the container refuse to start.
- `agentos_redis` → `/data`, with `--appendonly yes`. The queue holds scheduled
  work, so a Redis that forgot its state would silently stop every cron trigger
  and automation.

Every service has a healthcheck, and `api` and `web` both start behind
`condition: service_healthy` on what they depend on. That is what makes a bad
deploy fail rather than take over: Coolify waits for health before routing
traffic, so an API that cannot reach its database never replaces the one that
can. The API's own check hits `/health`; give it the 40s start period it has,
because migrations run before it serves traffic.

## 4. First boot

The API container runs migrations before it serves traffic, so there is no
separate migration step. After the first deploy, seed the roles and templates:

```sh
docker compose -f docker-compose.prod.yml exec api node packages/db/dist/seed.js
```

That creates one project, the thirty-seven catalogue agents with their recommended
skills, the twenty shipped skills, two environments, and the two built-in templates. Then read `AGENTOS_OPERATOR_TOKEN` from the Coolify UI,
open the web app, and paste it in.

## 5. What to check before trusting it with real work

Money and rendering paths get your own eyes, not a green test run
(`RECIPE.md` A1.7–A1.8):

- **Spend.** Create a goal with a small cap ($2), approve its checklist, and
  confirm it stops at the cap. The rail is enforced twice — in the loop and as a
  runtime session budget — but the number that matters is the one on your
  Anthropic bill.
- **Least privilege.** Open an agent and confirm the manifest in its prompt lists
  only what you granted. A support-style agent should show no repos.
- **Webhooks.** Fire a signed request at a trigger, then fire an unsigned one and
  confirm it is rejected and recorded.
- **Push.** Install the PWA on a phone, have an agent ask a question, and confirm
  the notification arrives and answering it resumes the session.

## 6. The local runner (optional, and read this first)

`apps/local-runner` is the second backend from SPEC §16: a worker on a machine
you own, running Claude Code instead of Anthropic's managed sandbox. The control
plane talks to it through the same `Runner` interface, so tasks, gates, the
inbox, and goals behave identically. Two things are *not* identical.

**It is off unless you turn it on.** Leave `LOCAL_RUNNER_URL` blank and every
session goes to the cloud runner. Everything below is the price of turning it on.

**Turning it on takes three things, and two of them are invisible.** Settings →
*Where sessions run* chooses `auto`, `local` or `cloud` for every agent that
does not pin a backend itself, and the screen shows whether a worker is actually
reachable. But the switch only governs an agent whose own preference is
`inherit`, and the worker **refuses** any agent whose environment restricts
egress — those sessions fall back to the cloud and bill for it. So: set
`LOCAL_RUNNER_URL` and run the worker, choose `local` in Settings, and give the
agent an `open` environment (or set
`LOCAL_RUNNER_ALLOW_UNENFORCED_NETWORK=1`, which accepts the risk globally).
The last one is a real security decision — an `open` environment means the
network wall is not enforced for that agent.

**It is not a sandbox.** Claude Code runs as the worker's unix user, in
`bypassPermissions`, inside a throwaway directory. The directory is deleted when
the session ends, but nothing stops a session reading whatever that user can
read.

**An agent on this backend can reach the worker's own credential, and there is
no configuration that prevents it.** Claude Code runs as the worker's unix user.
On Linux, anything running as that user can read `/proc/<worker-pid>/environ`,
and a `0600` credential file owned by that user is readable by it too. The
worker hands the agent a placeholder rather than the real credential, which
stops the obvious `env` read — but a determined, prompt-injected agent can walk
to the parent process. A separate unix *user* protects everything else on the
host from this backend; it does not protect this backend from the agent it
launched.

Deploying it as its own Coolify resource (`docker-compose.local-runner.yml`)
is still worth doing, and for a real reason — the container keeps agent code
away from the control plane, the database, the object store, and the rest of the
host. It does **not** put a wall between the worker and its own agent, because
both run as `node` inside it. Give it a domain, and set the shared token as a
**project-level shared variable** so both resources reference the same
`{{project.LOCAL_RUNNER_TOKEN}}` rather than two copies that drift.

What that means in practice: **use a credential you are willing to lose.** A
`claude setup-token` you can revoke, not an API key wired to a large balance.
And keep this backend off unless you want it — the cloud runner gives you a real
sandbox, and it is what `LOCAL_RUNNER_URL` being blank selects.

Two ceilings bound the damage if it does go wrong: `LOCAL_RUNNER_MAX_SESSION_MINUTES`
(default 120) stops a run the control plane has lost track of, and
`LOCAL_RUNNER_MAX_SESSION_REQUESTS` (default 500) caps how many model calls one
session can push through the credential proxy — the SDK's own spend cap covers
only the calls it makes, not calls an agent issues itself.

**What the worker does do about the credential.** The agent's process never
receives it: the worker runs a per-session loopback proxy, hands the child a
placeholder key, and injects the real credential only on the way out. The proxy
authenticates that placeholder, forwards only `POST /v1/messages` and
`/v1/messages/count_tokens`, and dies with the session — verified from inside a
live sandbox, where `/v1/models` returned 403, an unauthenticated call returned
401, and the operator token was absent from the environment entirely. That is a
real wall against a prompt-injected agent; it is not a wall against a hostile
process sharing the user account, which is why the paragraph above exists.

**It refuses a repo it has no credential for.** Same rule the cloud runner already
applied. Cloning anonymously instead failed obscurely mid-run on a private repo,
and on a public one succeeded while the session prompt still advertised write
access the agent did not have. Attach a secret to the repo, or drop the grant.

**The network wall, and what this worker can honestly do about it.** The cloud
runner gets an egress firewall from Anthropic; a VM has whatever you configured,
which the worker cannot see. Three settings, in order of how much they promise:

| Setting | Behaviour |
|---|---|
| both unset (default) | A `limited`-network session is **refused**, and the router sends it to the cloud runner. Nothing is promised that is not kept |
| `LOCAL_RUNNER_ALLOW_UNENFORCED_NETWORK=1` | Accepts the session, on **your** assertion that this machine is confined — a container network policy, or a host firewall scoped to this worker's unix user |
| `LOCAL_RUNNER_EGRESS_MODE=proxy` | Adds a loopback proxy per session that opens **only** the environment's allow-listed hosts, and hands the child `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY`. What it refuses is written into the session log |

**The proxy is a layer, never the permission.** It does not on its own make a
`limited` session acceptable, and the worker will not treat it that way: an
agent with a shell can open a socket directly or unset the proxy variables, so
`proxy` alone would be a promise this process cannot keep. What it does is hold
every ordinary client — curl, git, node, pip, npm — and every accident, on top
of whatever confinement you actually configured. If a session genuinely must
not reach a host and the machine is not confined, run it on the cloud runner,
which has a real egress fabric.

Two related details the worker enforces on its own: a granted environment
variable named `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, `ANTHROPIC_BASE_URL`,
`ANTHROPIC_API_KEY` or the like is **refused and logged** rather than injected —
those names configure containment, not the session — and the runtime's own
values are applied after the granted ones regardless.

### The Grok engine

An agent whose model starts with `grok` runs on xAI's OpenAI-compatible API
instead of Claude Code — SPEC §16's "Grok in yolo mode". Set `GROK_API_KEY`
(`LOCAL_RUNNER_GROK_BASE_URL` defaults to `https://api.x.ai/v1`). The engine
exposes the same AgentOS tools, forwarded to the control plane exactly as the
Claude engine forwards them, plus a workspace toolset — shell, read, write,
list — confined to the session's throwaway directory. No approval prompts:
there is no human at the keyboard, and the confinement is the directory, the
session ceilings, and the unix user, not a dialog.

Three honest limits. Spend is **not** reported: xAI returns tokens, not dollars,
so a Grok session records no cost — which is why a session that carries a budget
at all (every specialist under a goal's spend cap) is **refused** by this engine
rather than run unmetered; route those to the cloud runner. Turns are bounded by
`LOCAL_RUNNER_MAX_SESSION_REQUESTS`. And without a key, a Grok-model session
fails loudly rather than silently running on Claude.

Give it `GROK_API_KEY_FILE` (a `0600` file owned by the worker's user) rather
than `GROK_API_KEY` where you can, for the same reason as the Claude token: a
file the worker reads and closes is never in `/proc/<pid>/environ`, which the
agent's own shell can read.

### Credentials

Use `CLAUDE_CODE_OAUTH_TOKEN`, from `claude setup-token` on that machine. That
bills against a Claude subscription at a flat rate, which is the entire economic
argument for this backend. `ANTHROPIC_API_KEY` works as a fallback but bills per
token — measured here, one small task cost **$0.23 on the API key against
$0.02–0.03 for the same shape of task on the cloud runner**, because Claude Code
does far more reading and tool use per turn. On an API key you would be paying
more than the cloud runner *and* giving up the sandbox.

The worker never receives an AgentOS credential. Every `agentos_*` and `fs_*`
tool call it makes is forwarded to the control plane and answered there.

There is one `.env.example`, and in development both halves read one `.env`.
In production they are two machines and the worker gets **only** these four
variables — never the control plane's file, which holds the database URL, the
operator token, and your object-storage keys:

On Coolify:

```
resource 2:  docker-compose.local-runner.yml
             CLAUDE_CODE_OAUTH_TOKEN   = <claude setup-token>
             LOCAL_RUNNER_TOKEN        = {{project.LOCAL_RUNNER_TOKEN}}
             assign it a domain

resource 1:  docker-compose.prod.yml
             LOCAL_RUNNER_URL          = https://<the runner's domain>
             LOCAL_RUNNER_TOKEN        = {{project.LOCAL_RUNNER_TOKEN}}
```

Or on a plain VM, without containers:

```sh
pnpm install && pnpm --filter @agentos/local-runner build
CLAUDE_CODE_OAUTH_TOKEN_FILE=/etc/agentos/claude-token   # 0600, owned by this user
LOCAL_RUNNER_TOKEN=$(openssl rand -hex 32)
LOCAL_RUNNER_WORK_ROOT=/var/lib/agentos-local
LOCAL_RUNNER_MAX_SESSION_MINUTES=120
LOCAL_RUNNER_QUARANTINE_DAYS=14
LOCAL_RUNNER_PORT=4600
node apps/local-runner/dist/main.js  # :4600
```

Then set an agent's `runner` to `local` in `agentos.yml`, or a goal's runner
preference. `auto` prefers local when it is healthy and falls back to cloud when
it is not — including when it refuses a limited-network session.

## 7. Error reporting (wired in — set one variable)

The premise of this product is that you are not watching. That makes a failure
which only reaches stdout a failure that did not happen, and it has bitten twice
already: a broken orphan sweep logged a 400 on every pass and would have reported
zero orphans forever, and six abandoned agent workspaces sat on a disk for days
because a destroy failure only ever reached a log line. Both were found by
accident.

Set `GLITCHTIP_DSN` to any Sentry-compatible DSN and these report where you will
see them:

| Reported | Scope tag |
|---|---|
| A container that could not be destroyed | `session.destroy` |
| Each maintenance job that throws | `maintenance.*` |
| A queue job that failed (jobs get one attempt — this is the last word on it) | `worker.job` |
| Maintenance that could never be scheduled | `worker.maintenance-schedule` |
| Any API 5xx | `api.request` |
| An unhandled rejection or uncaught exception | `process.*` |

4xx responses are deliberately **not** reported: a Zod rejection or a 404 is the
API working, and reporting those turns the feed into a request log nobody reads.

**Leave it blank and nothing leaves the machine.** The default driver is
structured logging, so an operator who never configures GlitchTip still gets
every one of these in one greppable shape.

**What is scrubbed before sending.** This app's errors are unusually dangerous to
ship raw — a session's tool-call log carries task text and agent prose, and a
provisioning failure quotes the one request that carried resolved secrets. So
reports are redacted twice over: credentials by pattern (Anthropic keys and
setup tokens, `Authorization`/`x-api-key` values, credentials inside git and
database URLs, bare 64-hex secrets) plus the exact values of every known secret
env var; and narrative fields (`description`, `prompt`, `systemPrompt`, `body`,
`note`, `summary`, `progressLog`, `toolCallLog`, …) are dropped outright rather
than pattern-matched, because there is no regex for "this sentence names a
customer". Sentry's default integrations are disabled for the same reason — they
attach request bodies and local variables.

`DEPLOY_ENV` tags reports so staging does not look like production, and `RELEASE`
is an optional build id so a regression points at a deploy.

## 8. Other operational extras (deploy when they pay off)

`RECIPE.md` A8 suggests these; neither is wired in:

- **Umami** — cookieless analytics. Single-operator, so low value.
- **NocoDB** — read-only DB inspector, on Tailscale only, with a dedicated
  read-only Postgres user. Never public: writes would bypass the approval gate.

## 8. Backups

Two things are irreplaceable: the Postgres volume (tasks, goals, sessions,
grants) and the R2 bucket (the agent filesystem). Containers are disposable by
design — a session that dies is a session, not data.

Coolify backs up Postgres on a schedule and can push the dumps to S3 — point it
at the `postgres` service, not the volume, so you get consistent dumps rather
than a copy of files mid-write. R2 has its own versioning; turn it on.

The Redis volume is deliberately *not* in that list. It holds queue state, which
is reconstructible: on boot the API re-installs every cron scheduler from the
database, and `maintenance` re-releases any chain step whose enqueue was lost.
