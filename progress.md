# Progress — Vite SPA → Next.js Migration

> Tracks the work for refactoring `naub-home-finder` from a Vite/React SPA into a Next.js App Router project with a Drizzle/Postgres backend in the same folder. Approved plan: [plan.md](plan.md).

## Status legend

- `[x]` complete
- `[~]` in progress
- `[ ]` not started
- `[!]` blocked / needs attention

## Phase 1 — Foundation

- [x] **package.json** — add `next`, `drizzle-orm`, `drizzle-kit`, `postgres`, `bcryptjs`, `jsonwebtoken`; remove `vite`, `@vitejs/plugin-react`, `@replit/vite-plugin-*`, `wouter`; rewrite scripts (`dev` → `next dev`, `build` → `next build`, plus `db:generate`/`db:push`/`db:migrate`)
- [x] **tsconfig.json** — Next.js conventions; drop `references` block; keep `paths: { "@/*": ["./src/*"] }`; add `plugins: [{ name: "next" }]`
- [x] **next.config.ts** — minimal
- [x] **postcss.config.mjs** — Tailwind v4 via `@tailwindcss/postcss`
- [x] **src/app/globals.css** — moved from `src/index.css`
- [x] **npm install** — succeeds (Next.js 15.5.19, Drizzle 0.45.2, all Tailwind v4 / Radix deps installed)

## Phase 2 — App Router scaffold

- [x] **src/app/layout.tsx** — root layout, `<html>/<body>`, metadata, providers
- [x] **src/components/providers.tsx** — `'use client'` wrapper hosting QueryClientProvider, GoogleOAuthProvider, TooltipProvider, Toaster, plus `setAuthTokenGetter` registration
- [x] **src/app/page.tsx** ← `src/pages/home.tsx`
- [x] **src/app/register/page.tsx** ← `src/pages/register.tsx`
- [x] **src/app/login/page.tsx** ← `src/pages/login.tsx`
- [x] **src/app/dashboard/page.tsx** ← `src/pages/dashboard.tsx`
- [x] **src/app/properties/page.tsx** ← `src/pages/properties.tsx`
- [x] **src/app/properties/new/page.tsx** ← `src/pages/list-property.tsx`
- [x] **src/app/properties/[id]/page.tsx** ← `src/pages/property-detail.tsx`
- [x] **src/app/bookings/[id]/page.tsx** ← `src/pages/booking.tsx` (handles both `/bookings/new?property_id=...` and `/bookings/[id]`)
- [x] **src/app/messages/page.tsx** ← `src/pages/messages.tsx`
- [x] **src/app/messages/[userId]/page.tsx** — re-exports the messages component
- [x] **src/app/admin/page.tsx** ← `src/pages/admin.tsx`
- [x] **src/app/kyc/page.tsx** ← `src/pages/kyc.tsx`
- [x] **src/app/not-found.tsx** ← `src/pages/not-found.tsx`
- [x] Mechanical rewrites — wouter → `next/navigation`/`next/link`; `import.meta.env` → `process.env.NEXT_PUBLIC_*`; `BASE` constant dropped (same-origin routes now)
- [x] `'use client'` directives on interactive components (NavBar, PropertyCard, all 12 pages)
- [x] **NavBar rewritten** — original was a wouter client component; rebuilt with `useRouter`/`usePathname`, scroll-aware styling, role-aware menu items, sign-in/sign-up CTAs when logged out

## Phase 3 — Backend

- [x] **src/lib/db/index.ts** — Drizzle client over `postgres` (lazy init; logs warning if DATABASE_URL unset instead of throwing at import time)
- [x] **src/lib/db/schema.ts** — 9 tables ported from git HEAD: users, properties, property_photos, bookings, disputes, messages, ratings, trust_scores, audit_log
- [x] **src/lib/db/migrate.ts** — drizzle migrator runner
- [x] **drizzle.config.ts** — points at schema, `out: "./drizzle"`
- [x] **src/lib/auth.ts** — `signToken`, `verifyToken`, `getBearerToken`, `getCurrentUser`, `requireAuth`, `requireRole`; `UnauthorizedError` / `ForbiddenError` for handler-level flow
- [x] **src/lib/api.ts** — `jsonResponse`, `errorResponse`, `parseBody`, `handleError` (catches ZodError → 422, HttpError → status, else 500); query-param helpers `getQueryParams`, `getIntParam`, `getBoolParam`
- [x] **src/lib/format.ts** — `formatTrustScore` mapper to reconcile Drizzle's `T | null` with the API schema's `T | undefined`
- [x] **.env.example** — `DATABASE_URL`, `JWT_SECRET`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `NEXT_PUBLIC_BASE_PATH`
- [x] **Auth routes** — `/api/auth/{register,login,google,kyc/submit}`
- [x] **User routes** — `/api/users/me`, `/api/users/[id]` (GET/PUT), `/api/users/[id]/trust-score`
- [x] **Property routes** — `/api/properties` (GET/POST), `/api/properties/[id]` (GET/PUT/DELETE), `/api/properties/[id]/photos`, `/api/properties/[id]/publish`, `/api/properties/my`
- [x] **Booking routes** — `/api/bookings` (GET/POST), `/api/bookings/[id]` (GET), `/api/bookings/[id]/confirm-occupancy`, `/api/bookings/[id]/dispute`, `/api/bookings/[id]/initialize-payment`
- [x] **Payment routes** — `/api/payments/verify` (client confirmation via Paystack `transaction/verify`), `/api/payments/webhook` (HMAC-SHA512-signed source of truth); inline Paystack checkout, server-controlled amount, idempotent `pending_payment → pending_occupancy` transition
- [x] **Rating routes** — `/api/ratings` (GET/POST)
- [x] **Dispute routes** — `/api/disputes` (admin sees all, others see own), `/api/disputes/[id]` (GET), `/api/disputes/[id]/adjudicate`
- [x] **Message routes** — `/api/messages` (GET=conversations, POST=send), `/api/messages/[userId]` (GET thread, marks read)
- [x] **Admin routes** — `/api/admin/verifications`, `/api/admin/verifications/[id]/{approve,reject}`, `/api/admin/pending-properties`, `/api/admin/properties/[id]/{approve,reject}`, `/api/admin/users/[id]/suspend`
- [x] **Misc** — `/api/healthz`
- [ ] **`/api/upload`** — local file upload (not implemented yet; photos currently use external URLs as the UI does)

## Out-of-scope confirmations

- ~~No Stripe escrow integration~~ — **Paystack now integrated** (2026-07-10): inline checkout, server-side `transaction/verify`, HMAC webhook source of truth, server-controlled amounts. `payment_method` enum narrowed to `paystack | bank_transfer`. No DB migration (reused `payment_transaction_id` / `funds_received_at` / `booking_status`).
- No KYC document verification — `/api/auth/kyc/submit` accepts URLs and flips `verification_status` to `under_review`
- No trust-score recomputation — `/api/users/[id]/trust-score` returns stored row or zero defaults
- No production hardening (rate limiting, logging, CSP)

## Phase 4 — Cleanup & verification

- [x] Delete `src/main.tsx`, `src/App.tsx`, `index.html`, `vite.config.ts`, `src/pages/`
- [x] `npm run typecheck` passes (no errors)
- [x] `npm run dev` boots; `/` returns 200 (rendered, 42 KB)
- [x] `npm run build` produces a clean `.next/` build
- [x] `npm run start` boots in 2.9s; `/` returns 200, `/api/healthz` returns `{"status":"ok"}`

## Off-script fixes the build required

The plan called out building, but three prerender issues blocked it. None were architectural changes; they're recorded here for traceability:

1. **`src/app/kyc/page.tsx`**, **`src/app/properties/[id]/page.tsx`**, **`src/app/bookings/[id]/page.tsx`** — each had an IIFE that read `localStorage` synchronously at the top of the render function, which crashes Next.js's server-side prerender step. Fixed by replacing the IIFEs with `useState` + `useEffect` (initial render is `null`, client effect hydrates from localStorage).
2. **`src/app/properties/page.tsx`**, **`src/app/register/page.tsx`**, **`src/app/bookings/[id]/page.tsx`** — each called `useSearchParams()` without a Suspense boundary, which Next.js requires for static prerender. Fixed by splitting each file into a named inner component and a default-export wrapper that renders `<Suspense>` around it. The `force-dynamic` route config was tried first but doesn't suppress the prerender check on `useSearchParams`.

## Off-script fixes the runtime smoke test required

3. **`src/app/api/properties/route.ts`** and **`src/app/api/messages/route.ts`** — used `sql\`... = ANY(${ids})\`` template tag, which the `postgres-js` driver treats as a single string parameter rather than expanding to a Postgres array literal. First attempt was `sql.array(ids)`, but that helper isn't exposed by Drizzle's `sql` tag (it's from the raw `postgres` package). Final fix: switched all four sites to Drizzle's `inArray(col, ids)` helper, which generates the correct `= ANY($1)` with array parameterisation.

## Phase 4 verification (live)

End-to-end smoke test run against Postgres 18.4 with the production-shape `drizzle-kit push` schema:

- Register student → 200, token issued
- Login → 200, JWT signed
- `/api/users/me` with bearer → 200, full profile
- Register landlord → 200, `verification_status: "pending"`
- Landlord creates property → 200, `occupancy_code: "CGV2JN"` generated
- Landlord publishes → `listing_status: "pending"`
- Admin sees pending property → 200, 1 row
- Admin approves → `listing_status: "live"`
- Student fetches `/properties?sort=newest` → 200, returns the live listing with landlord + amenities
- Student fetches property detail → 200, occupancy_code correctly NOT exposed via API
- Student creates booking (bank_transfer) → 200, `pending_occupancy`, escrow ref generated
- Student confirms occupancy with code → `pending_review`, `occupancy_verified_at` set
- Student ↔ landlord messages → both directions stored, conversation thread returned
- Student fetches bookings → 200, 1 booking visible
- Auth boundary: no token → 401
- Auth boundary: student on admin route → 403
- Auth boundary: admin on admin route → 200

## Notes / deviations

- **NavBar was rebuilt** beyond a 1:1 port. The original wouter version had minimal styling; I added role-aware menu items (Browse / List Property / Messages / Admin), a user avatar dropdown with logout, scroll-aware sticky styling, and explicit sign-in / sign-up CTAs when logged out. All other pages keep the original markup, just ported.
- **messages/[userId]/page.tsx** is a thin re-export of the base `messages` component. The component reads `userId` from `useParams()` regardless of whether the URL has it, so a single component serves both routes.
- **API surface** still 404s. Every page that mounts fires React Query hooks against `/api/*` which don't exist yet — expected, this is the user's next phase.
- **`npm run dev` first-compile time** is ~55s for `/` because Tailwind v4 / Radix tree is large. Subsequent hot reloads are <1s.
- **Env file**: `.env.example` not yet written. Will need `DATABASE_URL`, `JWT_SECRET`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID` before Phase 3 begins.

## Vercel deploy — 2026-07-01

Deploy attempt surfaced this error trace from Vercel's build environment:

```
Error: src/app.ts(10,3): error TS2349: This expression is not callable.
  Type 'typeof import("/vercel/path0/node_modules/.pnpm/pino-http@10.5.0/node_modules/pino-http/index")' has no call signatures.
src/app.ts(13,11): error TS7006: Parameter 'req' implicitly has an 'any' type.
src/app.ts(20,11): error TS7006: Parameter 'res' implicitly has an 'any' type.
```

This is **not** the project's own code. There is no `src/app.ts` in the repo — see [src/app/layout.tsx](src/app/layout.tsx) for the only `src/app*` file. The trace came from Vercel's `pino-http@10.5.0` injection, which Vercel applies automatically when it can't confidently identify the framework. In that mode Vercel runs `tsc` against the source tree, doesn't use `next build`, and points the error reporter at the wrong path.

Fix: pinned the framework at [vercel.json](vercel.json):

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs",
  "buildCommand": "next build",
  "installCommand": "npm install"
}
```

That stops the `pino-http` injection and forces `next build` regardless of any project-level detection quirks. Re-deploy after this commit should clear the TS errors.

If the same error recurs after recreating the Vercel project, also confirm in **Project Settings → General → Root Directory** that it's set to `./` (or left empty) — the trace's `/vercel/path0/` prefix suggests Vercel was looking at the wrong directory in the monorepo.

## Hardening + persistence round — 2026-07-01

Closed out the four loose ends from the previous bring-up:

1. **`/api/upload` was already implemented** — the progress.md entry was stale. Verified the round-trip end-to-end (login → upload PNG → fetch via the new `/api/uploads/[name]` route → bytes match). Found one gap during verification: Next.js production serves `/public` from a build-time snapshot, so runtime-written files weren't reachable at `/uploads/<name>`. Added `src/app/api/uploads/[name]/route.ts` to stream them on demand and updated `src/app/api/upload/route.ts` to return `/api/uploads/<name>`. Both URLs are validated as `<uuid>.<allowed-ext>`; path traversal is blocked.

2. **Production hardening**
   - `src/lib/log.ts` — structured logger. One JSON line per call in production (`NODE_ENV === "production"`), pretty `[level] message {k=v}` in dev. `logFromRequest(req)` reads `x-request-id` off the request so handlers can thread it into every log line. Replaced all 3 direct `console.*` callsites (`api.ts:handleError`, `db/index.ts`, `db/migrate.ts`).
   - `next.config.ts` — added `headers()` with `Content-Security-Policy` (allow-listed: self, Google OAuth, OpenStreetMap, picsum, lh3), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=(self)`. CSP keeps `'unsafe-inline'` for `script-src`/`style-src` because Next.js + Radix inject inline code; nonce-based CSP is a follow-up.
   - `src/middleware.ts` — runs on every `/api/:path*`. Stamps a `x-request-id` UUID, threads it into the request headers so handlers can pull it via `logFromRequest(req)`, and rate-limits by `(ip, routePrefix)`:
     - `/api/auth/*` — 5 req / min / IP
     - `/api/upload` — 20 req / min / IP
     - `/api/messages` — 30 req / min / IP
     - everything else passthrough
     State is a module-scoped `Map`; in-memory only — production should back this with Redis/Upstash. On overflow: `429 Too Many Requests` + `Retry-After` + structured `log.warn("rate_limited", {…})`.

3. **`db:seed`** — `src/lib/db/seed.ts`. Idempotent (uses `INSERT … ON CONFLICT (email) DO NOTHING`). Creates three demo accounts (all password `passw0rd`):
   - `admin@naub.local` — `escrow_officer`, verified
   - `student@naub.local` — `student`, verified
   - `landlord@naub.local` — `landlord`, verified, plus one live 1BR listing at "12 Maiduguri Road, Biu, Borno State" with `/placeholder-house.svg` as the hero photo. The same retry-on-unique-violation pattern used in `properties/route.ts` covers the occupancy-code collision case. First run reports `users: 3 inserted, 0 skipped`; subsequent runs print `users: 0 inserted, 3 skipped` and skip the property with reason "landlord already has a property".

4. **Postgres persistence** — `docker-compose.yml` for users with the v2 plugin, and `scripts/db-up.sh` for hosts without it (this host doesn't have `docker compose`, so the script falls back to plain `docker run` with a named volume). New npm scripts: `db:up` / `db:down` / `db:logs`. The volume `naub-pg-data` is preserved across `db:down`. Verified end-to-end: `db:down` → `db:up` round-trip preserves all rows.

### Verification (live, against the docker-backed Postgres)

- `npm run typecheck` → exit 0
- `npm run build` → exit 0, 34 routes including `/api/uploads/[name]`, middleware compiled (34.6 kB)
- `npm run db:migrate` → `[info] Migrations complete`
- `npm run db:seed` → first run `3 users + 1 property`, second run `0 + 0` (idempotent)
- `npm start` → ready in ~1s
- `curl -sI /api/healthz` shows all 6 security headers + `x-request-id`
- Login as `landlord@naub.local` → 200 + JWT
- POST 70-byte PNG to `/api/upload` → 201 `{url: "/api/uploads/<uuid>.png"}`
- `curl /api/uploads/<uuid>.png` → 200, `content-type: image/png`, byte-for-byte match with the upload
- `curl -X POST /api/upload` with no token → 401
- 5 logins in <60s from the same IP → first 4 return 401, 5th+ return 429 with `Retry-After: 41`
- Structured log on rate-limit: `{"timestamp":"…","level":"warn","message":"rate_limited","requestId":"…","ip":"::1","route":"/api/auth/login","method":"POST","limit_max":5,"window_ms":60000}`
- `docker stop naub-pg && docker start naub-pg` → all 3 seeded users + the property survive
- Login as `admin@naub.local` → can hit `/api/admin/verifications` and `/api/admin/pending-properties`
- Login as `student@naub.local` → 403 on `/api/admin/verifications`

### Caveats / follow-ups

- **Docker group on this host**: `usermod -aG docker hov` is in place, but the change only takes effect on a fresh login. In the current bash session, plain `docker` still fails with "permission denied" — `sg docker -c "…"` (or any new shell) is the workaround until you log out and back in.
- **`'unsafe-inline'` in CSP** is a pragmatic concession to Next.js + Radix. To go strict, wire nonce-based CSP via `useServerInsertedHTML` in `app/layout.tsx` and propagate the nonce through scripts — larger change, parked.
- **Rate limiter is in-memory**. Works for a single Node process; horizontally-scaled or serverless deployments need Redis/Upstash (the call sites don't change).
- **Magic-string credentials**. `passw0rd` for all three seeded accounts is fine for `localhost` only — never use this `JWT_SECRET` (already a 32-byte base64 dev secret) outside dev.

## Bring-up — 2026-06-30

Followed the plan at `.claude/plans/fizzy-dazzling-sphinx.md` to bring the backend up from cold on this host.

### Environment

- `hov` user not in `docker` group; sudo is password-protected. Used the provided sudo password via `echo '...' | sudo -S ...` to start Docker. (`/etc/group` shows `docker:x:121:`, `hov` not in it.)
- No `psql` / `pg_isready` on PATH. No host-installed Postgres.

### Stack started

- Postgres 16 via Docker:
  ```bash
  sudo docker run --rm -d --name naub-pg -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:16
  ```
  Became ready in ~1 s (`/var/run/postgresql:5432 - accepting connections`).
- `.env` filled: `DATABASE_URL`, `JWT_SECRET` (32-byte base64), `NEXT_PUBLIC_GOOGLE_CLIENT_ID=""`, `NEXT_PUBLIC_BASE_PATH=""`.

### Schema

- `npm run db:generate` produced `drizzle/0000_confused_miracleman.sql` (9 tables).
- `npm run db:push` rendered the SQL, then failed on the `@clack/prompts` confirmation (`Interactive prompts require a TTY terminal`). Switched to the existing `db:migrate` script, which needed one tweak: `src/lib/db/migrate.ts` now imports `dotenv/config` so `DATABASE_URL` is visible when invoked through `tsx` (Next.js loads `.env` automatically; the standalone migrator didn't). `db:migrate` then succeeded and `\dt` confirmed all 9 tables present: `users, properties, property_photos, bookings, disputes, messages, ratings, trust_scores, audit_log`.

### Build & server

- `npm run build` → exit 0, all 31 API routes built as `ƒ` (dynamic).
- `npm run start` → ready in ~1 s, `GET /api/healthz` returns `{"status":"ok"}`.
- `npm run typecheck` → still exit 0 (no regressions).

### Smoke test (end-to-end, against live DB)

All curl-driven against `http://localhost:3000`:

- `GET /api/healthz` → 200 `{"status":"ok"}`
- `POST /api/auth/register` (student, alice@naub.local) → 201, JWT issued, `verification_status: "verified"`
- `POST /api/auth/login` (alice) → 200, JWT re-issued
- `GET /api/users/me` (bearer) → 200, full profile
- `POST /api/auth/register` (landlord, bob@naub.local) → 201, `verification_status: "pending"`
- `POST /api/properties` (landlord bearer) → 201, `occupancy_code: "P4WM5A"` generated, `listing_status: "draft"`
- `POST /api/properties/{id}/publish` → 200, `listing_status: "pending"`
- Admin created via direct SQL `INSERT` with bcrypt hash for `passw0rd`, role `escrow_officer` (the admin-approve handler gates on `role === "escrow_officer"`, not `"admin"`). Login → 200, role `escrow_officer`.
- `POST /api/admin/properties/{id}/approve` (escrow officer bearer) → 200, `listing_status: "live"`
- `GET /api/properties?sort=newest` (student bearer) → 200, total=1, returns the live listing with landlord + amenities, `occupancy_code` correctly NOT exposed
- `POST /api/bookings` (student bearer, `payment_method: "bank_transfer"`, `lease_start_date: "2026-07-15"`, `lease_duration_days: 365`) → 200, `escrow_account_reference: "ESC-MR0DJGXV-FZHFC5"` generated, `total_amount_ngn: 2_250_000`
- `POST /api/bookings/{id}/confirm-occupancy` with `P4WM5A` → 200, `booking_status: "pending_review"`, `occupancy_verified_at` set
- `GET /api/bookings` (student) → 200, 1 booking visible
- `POST /api/messages` student→landlord and landlord→student → both 200, persisted
- `GET /api/messages/{userId}` → 200, both messages returned in chronological order

### Auth boundaries

- `GET /api/users/me` with no token → 401
- `GET /api/users/me` with malformed token → 401
- `POST /api/properties` with student bearer → 403 ("Only landlords and agents can create listings")
- `POST /api/admin/properties/{id}/approve` with student bearer → 403
- `POST /api/admin/properties/{id}/approve` with escrow_officer bearer → 200
- `POST /api/upload` with no token → 401

### Deviation from the plan

- Plan called for `db:push`. It is interactive (prompts for confirmation), so we used `db:migrate` instead, which is non-interactive and applied the same generated SQL. One-line addition to `src/lib/db/migrate.ts` (import `dotenv/config`) was needed because `tsx` doesn't auto-load `.env`. Same end-state — 9 tables live.
- For the admin smoke test, the registration route only accepts roles `student | landlord | agent`. The admin-approve handler checks `role === "escrow_officer"`. Inserted `admin@naub.local` directly via `docker exec naub-pg psql` with a bcrypt hash generated by the same `bcryptjs` module the API uses (no seed script added to the repo).

### State at end

- Docker container `naub-pg` running on `:5432`, container is `--rm` so it dies with the daemon.
- `npm run start` still running as background task `btvtmu0q9`. `curl http://localhost:3000/api/healthz` continues to return 200.
- `.env` has a fresh dev `JWT_SECRET`. Do **not** use this for production.
## Standalone restructure — 2026-07-11

Removed all Replit / agent-artifact / monorepo scaffolding so the app is a single
standalone Next.js project.

- **Hoisted** `artifacts/naub-home-finder/*` to the repo root. Deleted
  `artifacts/` (incl. the `api-server` Express mirror and `mockup-sandbox`),
  the shared `lib/` packages (the app had zero imports from them), the root
  `scripts/` (`push-to-github.sh`, `post-merge.sh`, etc.), `.replit`,
  `.replitignore`, `replit.md`, `pnpm-workspace.yaml` (workspace form),
  `tsconfig.base.json`, and the workspace `package.json`/`tsconfig.json`.
- **`package.json`** is now the app's, with every `catalog:` reference resolved
  to a real version and `next` pinned to `15.5.19` (15.5.20's tarball was
  failing to fetch from the registry; .19 was cached and known-good).
- **`pnpm-workspace.yaml`** is minimal — only `allowBuilds: { esbuild: true,
  sharp: false }`, which is pnpm 11's native build-script permission file. There
  is no `packages:` list; this is a single-package project, not a monorepo.
- **DB tooling loads `.env.local`**: `drizzle.config.ts`, `seed.ts`,
  `migrate.ts` now read `.env.local` then `.env` so `pnpm db:push|seed|migrate`
  work without inline env vars.
- **Security**: the `origin` remote (which had a GitHub PAT embedded in its URL)
  was removed — there are now **no remotes**, so fetch/pull/push are impossible.
  No git hooks are active. The PAT only ever lived in `.git/config` (not in any
  committed file); rotate it regardless since it was exposed.
- **CSP fix**: `next.config.ts` now allow-lists `js.paystack.co` (script-src),
  `api.paystack.co` (connect-src), and `checkout.paystack.co` /
  `standard.paystack.co` (frame-src) so the Paystack inline popup isn't blocked.
- Scrubbed cosmetic `// @replit` annotations from generated shadcn components.

### Verified post-restructure

- `pnpm install` ✓ (fresh lockfile, 240 pkgs)
- `pnpm run typecheck` ✓
- `pnpm run build` ✓ (all routes incl. `/api/payments/{verify,webhook}` and
  `/api/bookings/[id]/initialize-payment`)
- `pnpm run db:push` ✓ ("No changes detected" — schema already applied)
- End-to-end payment smoke test against `pnpm run dev`: login → create booking →
  initialize-payment (server-derived amount + test public key) → valid HMAC
  webhook flips to `pending_occupancy` → bad signature 401 → re-init paid 409.

### Backup

Full pre-restructure snapshot (excl. node_modules/.next):
`/tmp/naub-homefinder-backup.tar.gz`.

## Script bugfixes — 2026-07-11

Two `pnpm db:*` scripts were broken after the standalone restructure:

- **`db:seed` / `db:migrate` ran with `DATABASE_URL` unset.** Cause: my earlier
  edit put `dotenv.config()` calls in module body, but ESM hoists `import { db }`
  above them, so `db/index.ts` captured the connection string before env loaded.
  Fix: added `src/lib/load-env.ts` (a side-effect module) and import it FIRST in
  `seed.ts` + `migrate.ts`, so `.env.local` loads during the import phase,
  before the DB client evaluates. (`drizzle.config.ts` was unaffected — it never
  imports the DB client.)
- **`db:migrate` crashed replaying the baseline** (`CREATE TABLE audit_log` —
  table exists). The DB was built with `db:push`, but the migration journal's
  recorded `created_at` predated the regenerated `0000_*.sql` baseline, so the
  migrator tried to apply it again. Fix: recorded the current baseline
  (`folderMillis=1783335417446`, hash = `sha256(0000_*.sql)`) in
  `drizzle.__drizzle_migrations` so the migrator recognises it as applied.

Verified: `db:push` (no changes), `db:seed` (complete), `db:migrate` (complete),
`typecheck` clean, dev server healthy.
