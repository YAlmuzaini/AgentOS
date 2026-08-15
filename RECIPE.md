# RECIPE.md — Engineering Contract

Coding agent for a solo builder shipping salable software. Read every boot. Follow unless the founder
overrides. The **idea is the only variable** — this recipe is fixed.

Founder: full-stack, Clean Architecture, multi-tenant SaaS, mobile (RN/Flutter), self-hosts.
Technical — skip basics. Straight output, minimal ceremony, brief rationale only when a call is
non-obvious.

Product shape is NOT assumed. It may be: multi-tenant SaaS, a one-off paid app, a mobile app, a
browser extension, an API-as-product, an ad-supported utility, a viral single-feature tool. **Part A
applies to everything. Part B applies only when the idea is actually multi-tenant SaaS** — don't
scaffold tenancy/RBAC/billing onto a $4.99 app or a keyboard extension.

---

# PART A — UNIVERSAL (every project)

## A1. Governance (non-negotiable)

1. **Commits are user-gated.** Never commit/push on your own. Present the diff, summarize, STOP.
2. **One session, one purpose.** Short, single-objective. Big features are SLICED (§A5), never
   crammed — drift correlates with run length.
3. **Never touch git while a session is running.** One session owns the tree. Git at the gate.
4. **≤300-line files.** Extract, don't bloat.
5. **Master-only. No feature branches.**
6. **Human-driven verification. No browser-automation tests** (Playwright/Puppeteer/Cypress) for
   UI/UX. The founder verifies live.
7. **"Tests green" ≠ done.** Green proves logic, not that it looks right, renders correctly, the
   money path works, or the UX isn't broken. Flag those for the founder's eyes.
8. **Verify money & visual/render paths against the founder's own eyes.** Never mark those done on a
   passing test alone.
9. **Living docs, read on boot & keep current:** `PRODUCT.md` (what & for whom), `PROGRESS.md`
   (living state — update every session), `DESIGN.md` (see A4), plus this file. Cross-session memory.
10. **No AI attribution in commits.** Clean messages.
11. **Flag, don't paper over.** A newly-failing test, a stub, a feature sold-but-unbuilt — surface it
    loudly. Never silently hide a gap.
12. **Don't build unrequested features.** Build the task. Spot scope creep → flag, don't add.

## A2. Engineering quality (any stack)

- **Secrets in env only.** Never committed, in a prompt, or inline in config. Referenced by name;
  fail/warn loud if a required secret is unset in prod.
- **Non-enumerable public IDs** (nanoid/uuid) for anything user-facing/guessable. Never sequential.
- **Provider interfaces for external dependencies** (payments, email, storage, AI, push). Program to
  the interface; log/stub driver for dev, real for prod. Don't hardcode a vendor.
- **One source of truth for anything duplicated across surfaces** (copy, contracts, shared logic).
  Marketing site + app + API must not each hardcode the same thing — it drifts.
- **Validate demand cheaply before over-building.** Ship the smallest thing that tests whether anyone
  wants it. Fast + sharp marketing beats a polished build nobody asked for.

## A3. Monetization (shape-agnostic)

Salable ≠ only SaaS. Pick the model that fits the idea and wire the minimum for it:
- **One-time / paid app** (App Store, Gumroad, Lemon Squeezy, Paddle) — simplest; no subscription
  machinery.
- **Subscription** — only if there's recurring value; then Part B billing applies.
- **Ad-supported / freemium** — for high-volume low-touch utilities.
- **API-as-product** — keys + metering + docs.
- Whatever the model: **be honest** — never sell/advertise a feature that isn't built.

## A4. DESIGN.md (generated, not authored)

`DESIGN.md` is an OUTPUT of the **Impeccable** skill, generated early in the project, then maintained.
Do not hand-author a design system. Run Impeccable to establish tokens/type/spacing/voice → `DESIGN.md`,
then every UI change conforms to it and re-runs the Impeccable critique (see A6).

## A5. Slicing a big/risky feature

When a feature touches data + UI + a sacred path (render/money/auth), do NOT do it in one session.
Land the safe foundation first, isolate + test the dangerous path last:

1. **Data model** (schema/contracts/persistence + tests) — no UI, no sacred-path change. Prove
   nothing existing breaks.
2. **Logic/ingestion** (backend) — still no UI.
3. **UI to author/manage** — first visual slice; sacred path untouched (placeholder, not the real
   render/charge yet).
4. **Integration/mapping** — connect the pieces.
5. **The sacred slice alone** (render/money) — isolated, verified with the founder's eyes (real
   output / real charge), compared to known-good where possible.

Each slice: single session, tested, committed at the gate before the next.

## A6. Agent tooling (install before session one)

- **Impeccable** (github.com/pbakaus/impeccable) — generates `DESIGN.md`; run the design-critique
  SKILL on every UI change, not just the detector hook. A report showing only `detect → []` means you
  ran the hook, not the skill — insufficient. Report P0/P1/P2 + fixes.
- **oh-my-claudecode** (github.com/Yeachan-Heo/oh-my-claudecode) — Claude Code workflow/hook layer.
  Baseline setup.

## A7. Stack default (TS everywhere)

The stack for solo, self-hosted, agent-built, ship-fast work: JS/TS everywhere. One language across
the whole stack, densest ecosystem, best agent familiarity. This is the proven default — use it
unless the founder explicitly names a different stack for a given project.

- **Monorepo:** pnpm workspaces + Turborepo. `@shared` (Zod contracts), `@db` (Drizzle + migrations),
  `apps/api` (NestJS, Clean Architecture), `apps/web` (Vite + React + TanStack Router/Query + Tailwind
  + shadcn/ui to `DESIGN.md` tokens; typed API client generated from OpenAPI, never hand-typed).
- **Backend:** NestJS · Drizzle + PostgreSQL · Better Auth · BullMQ + Redis for jobs.
- **Mobile (if applicable):** React Native or Flutter.
- **Storage:** MinIO (S3-compatible), signed URLs.
- **Rendering (if applicable):** HTML/CSS → Gotenberg (PINNED) → PDF → poppler → PNG → MinIO; fonts
  base64-embedded; never pdf-lib/pdfkit; preview + final share ONE render module (WYSIWYG parity).
- **i18n/RTL (if bilingual):** key strings from day one; logical CSS properties; founder
  writes/approves non-English copy — never ship machine translation as final.

## A8. Deploy (self-hosted default)

- **Host:** DigitalOcean via **Coolify**. `docker-compose.prod.yml`. Only public-facing services get
  domains; internal services reached privately. Secrets in Coolify, by name.
- **Marketing site (if the product needs one):** SEPARATE repo, static (Astro), root domain, zero/near
  -zero JS (SEO + Lighthouse), mirrors app brand tokens. App on `app.` subdomain.
- **Ops (deploy early when it pays off):** Umami (analytics, cookieless) · GlitchTip (errors,
  Sentry-SDK compat; scrub PII in `beforeSend`) · NocoDB (read-only DB inspector — dedicated READ-ONLY
  user, never public, Tailscale/auth only; writes bypass domain invariants).

---

# PART B — MULTI-TENANT SaaS ONLY (apply only if the idea is multi-tenant SaaS)

Skip this entire section for single-user apps, paid apps, extensions, or API products.

## B1. Tenancy & access

1. **One DB-access choke point that forces `org_id`.** All tenant-scoped access through a single
   scoped repo that can't be bypassed. No raw cross-tenant-capable queries.
2. **Guard chain: Auth → Tenant → RBAC**, in order, on every protected route. Ranked roles
   (owner > admin > member > viewer).
3. **Append-only domain state.** Never hard-delete meaningful records. Revoke/archive/soft-delete to a
   status; public resources return their state, never 404, once they've existed. Destructive ops are
   soft, reversible, owner-gated, explicitly confirmed.

## B2. Billing & entitlements

- **Behind a billing-provider interface** (Stripe default). **Meter on YOUR actual cost axis** — cap/
  price on what each customer actually costs you, not an arbitrary number. Cheap-to-you actions aren't
  the headline cap.
- **Entitlements = plan flags** checked at the seam. **Honest pricing:** every plan bullet maps to a
  built, enforced feature; strip phantom flags from the plan catalog, not just the UI. Leave price
  points provisional until a real buyer quotes a number.
- **Webhooks: raw-body signature verification + idempotency.** Preserve raw body for HMAC (framework
  body-parsers break this). Dedup by event id. Claim + apply atomically so a mid-apply crash doesn't
  strand the event on retry.
- **Billing go-live audit** before charging real cards: raw-body verify, idempotency, out-of-order
  events, cancel/payment-fail → downgrade paths, live-vs-test price IDs, prod fail-loud. Test via the
  payment provider's CLI + out-of-order triggers + the real proxy path. Then flip live keys.

## B3. SaaS ops

- **Admin ops that must respect domain logic** → in-app `/admin` route reusing services + a superadmin
  guard. NOT a bolted-on CMS writing to the DB behind your back.
- **System vs per-customer resource** (e.g. email sending): a system default for platform actions +
  free tier, a per-customer bring-your-own option (encrypted at rest) as a paid unlock that shifts
  cost to the customer.
