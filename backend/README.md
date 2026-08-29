# WESCOMM Backend

Standalone backend API for the Wesleyan Commissary System.

## Stack

- Node.js + Express
- TypeScript
- Prisma ORM
- Supabase PostgreSQL
- Supabase Auth

## Setup

1. Copy `.env.example` to `.env`.
2. Fill in the Supabase and database values from the database setup team.
3. Install dependencies:

```bash
npm install
```

4. Generate Prisma Client:

```bash
npm run prisma:generate
```

5. Run backend:

```bash
npm run dev
```

6. For a new Supabase project, run the platform bootstrap and feature SQL files
   in the documented order before recording the Prisma baseline. These files own
   Supabase Auth integration, RLS, storage, Realtime, checks, and seed data that
   Prisma cannot fully represent:

```txt
../txt_files/SUPABASE_SQL_EDITOR_COMMANDS.txt
../txt_files/DATABASE_WEB_PUSH_NOTIFICATIONS_SQL.txt
../txt_files/DATABASE_AUTH_SESSIONS_SQL.txt
../txt_files/DATABASE_RESERVATION_IDEMPOTENCY_SQL.txt
../txt_files/DATABASE_STUDENT_RESERVATION_RESTRICTIONS_SQL.txt
../txt_files/DATABASE_AUDIT_LOGS_SQL.txt
```

After the SQL bootstrap is complete, follow **Database migrations** below.

Complete free security setup and key-rotation instructions:

```txt
../txt_files/WESCOMM_FREE_SECURITY_SETUP.txt
```

Default API URL:

```txt
http://localhost:4000/api
```

## Main Routes

- `GET /api/health`
- `GET /api/health/ready`
- `POST /api/auth/session`
- `PATCH /api/auth/me`
- `POST /api/auth/logout`
- `GET /api/products`
- `GET /api/products/:id`
- `GET /api/reservations`
- `POST /api/reservations`
- `PATCH /api/reservations/:id/status`
- `GET /api/receipts`
- `GET /api/receipts/verify/:code`
- `GET /api/notifications`
- `GET /api/conversations`
- `GET /api/faqs`
- `GET /api/faqs/manage`
- `POST /api/faqs`
- `PATCH /api/faqs/:id`
- `DELETE /api/faqs/:id`
- `GET /api/staff/inventory`
- `POST /api/staff/inventory/:id/restock`
- `GET /api/staff/products`
- `GET /api/staff/products/categories`
- `GET /api/staff/products/:id`
- `POST /api/staff/products`
- `PATCH /api/staff/products/:id`
- `DELETE /api/staff/products/:id`
- `POST /api/staff/products/:id/restock`
- `POST /api/staff/products/:id/variants`
- `PATCH /api/staff/products/:id/variants/:variantId`
- `DELETE /api/staff/products/:id/variants/:variantId`
- `GET /api/staff/reports/summary`
- `GET /api/admin/reports/summary`
- `GET /api/admin/users`
- `PATCH /api/admin/users/:id/role`
- `GET /api/admin/audit-logs`
- `GET /api/restrictions/me`
- `GET /api/staff/restrictions`
- `POST /api/staff/restrictions`
- `PATCH /api/staff/restrictions/:id/lift`
- `PATCH /api/staff/restrictions/offenses/:id/overturn` (admin only)
- `POST /api/reservations/:id/no-show`
- `GET /api/payments/options`
- `POST /api/payments/gcash/checkout` (student)
- `GET /api/payments/:id` (owner, staff, or admin)
- `POST /api/payments/:id/reconcile` (staff or admin)
- `POST /api/payments/maintenance` (server-only maintenance bearer token)
- `POST /api/webhooks/paymongo` (raw signed PayMongo delivery)

PayMongo setup, attempt recovery, expiration/stock-hold policy, reconciliation,
GitHub Actions maintenance secrets, sandbox tests, and go-live gates are in
`../txt_files/WESCOMM_PAYMONGO_GCASH_SETUP.md`.

The browser exchanges its Supabase access token once through `POST /api/auth/session`, then uses a revocable HttpOnly cookie. Bearer tokens remain supported for trusted API testing.

## Security Configuration

Development test login is restricted to the exact emails in `AUTH_DEV_LOGIN_EMAILS` and is rate-limited. It is allowed only locally or on an isolated Vercel Preview/QA deployment. The backend refuses to start when it is enabled on Vercel Production or on a non-Vercel production runtime.

Recommended local values:

```env
NODE_ENV=development
AUTH_ENABLE_DEV_LOGIN=true
AUTH_DEV_LOGIN_EMAILS=student@wesleyan.edu.ph,staff@wesleyan.edu.ph,admin@wesleyan.edu.ph
# Generate a random 20+ character value and store it only in .env/password manager.
AUTH_DEV_LOGIN_PASSWORD=
TRUST_PROXY_HOPS=0
```

Required production values:

```env
NODE_ENV=production
AUTH_ENABLE_DEV_LOGIN=false
FRONTEND_ORIGINS=https://YOUR_FRONTEND_DOMAIN
# Use 1 only when the API is behind one trusted reverse proxy.
TRUST_PROXY_HOPS=1
AUTH_SESSION_TTL_HOURS=168
AUTH_SESSION_MAX_PER_USER=5
AUTH_ALLOWED_AUTH_METHODS=otp,magiclink,email/signup,token_refresh
DATA_ENCRYPTION_CURRENT_VERSION=v1
DATA_ENCRYPTION_KEYS=v1:YOUR_PRIVATE_32_BYTE_BASE64_KEY
```

`AUTH_ALLOWED_AUTH_METHODS` is checked against the verified Supabase JWT `amr` claim. Password-authenticated bearer tokens are rejected, and `token_refresh` is accepted only alongside an approved primary method. Add an explicitly reviewed method such as `oauth`, `sso`, or `saml` only when that provider is intentionally enabled.

For Vercel Preview/QA, enable access to Vercel System Environment Variables, keep `NODE_ENV=production`, and scope `AUTH_ENABLE_DEV_LOGIN=true`, a newly rotated sensitive `AUTH_DEV_LOGIN_PASSWORD`, and the exact QA email allowlist to one dedicated QA branch only. Protect that Preview deployment with Vercel access control and use its stable branch URL in `FRONTEND_ORIGINS`. Use a separate QA Supabase project/database containing fake data. Production must keep the generic `AUTH_ENABLE_DEV_LOGIN=false`. The backend verifies `VERCEL=1` and uses `VERCEL_ENV`/`VERCEL_TARGET_ENV` to distinguish Preview from Production without weakening secure-cookie and TLS validation.

If the project owner explicitly authorizes short public-Production staff testing, use the separate `AUTH_ENABLE_TEMP_PRODUCTION_STAFF_LOGIN` flow. It is hardcoded to `staff@wesleyan.edu.ph`, rechecks that the database role is still `STAFF` on every temporary-session request, requires matching frontend/backend UTC expiry values no more than 24 hours ahead, and caps each issued session at 30 minutes or the configured deadline. Store `AUTH_TEMP_PRODUCTION_STAFF_LOGIN_PASSWORD` as a new Vercel Production Sensitive value of at least 20 characters. Keep student/admin on OTP, stage a narrow Vercel WAF rate-limit rule for `POST /api/auth/temporary-staff-login`, and audit successful temporary logins. To stop early, publish a project WAF block for that route, disable both temporary flags, remove the secret/expiry, redeploy, make every previously enabled immutable deployment URL inaccessible, and revoke the staff account sessions. Old Vercel deployments retain their original environment values until they are blocked or removed; the absolute expiry remains the final fail-safe.

The API applies request IDs, strict CORS, CSRF origin checks, security headers, no-store caching for authenticated data, action-specific rate limits, bounded request schemas, image signature validation, encrypted sensitive fields, revocable hashed sessions, privacy-safe push notifications, and privacy-safe public receipt verification. Production and Vercel runtimes use atomic PostgreSQL rate-limit counters shared by every instance; local development and unit tests use the in-memory store. Expired database counters are pruned by the existing payment-maintenance job.

Never commit `.env`. Rotate any service-role, database, SMTP, or private VAPID credential that has been pasted into chat, screenshots, issues, or shared documents.

## Audit Logs

Admin activity tracking uses the `audit_logs` table. The PayMongo migration safely adopts an existing compatible table or creates it when absent. The backend records important actions such as product creation/update/archive/restock, product image upload, reservation and payment status changes, receipt generation/verification, FAQ changes, support status updates, and admin user role changes.

PayMongo lifecycle audit writes are part of the same database transaction as the financial state change. Older operational audit calls remain best-effort so a logging outage does not incorrectly replay a completed business action. Apply all Prisma migrations before enabling payments; `/api/admin/audit-logs` requires the table to exist.

## Reservation Stock Safety

`POST /api/reservations` now uses a Prisma database transaction. The backend checks stock, creates the reservation, writes reservation items, deducts inventory, records inventory movement, and creates reservation/low-stock notifications as one atomic flow. If stock changes while a student is reserving, the API returns `409` and the reservation is not saved.

`PATCH /api/reservations/:id/status` also handles cancellation stock restoration inside a transaction, so cancelling a reservation restores stock and records the inventory movement together with the status change. Completing a reservation creates or repairs its single server-derived receipt in the same serializable transaction. Receipt notifications and audit delivery are written to the outbox in that transaction and can be retried safely.

## Free-plan database resilience

Production runtime queries use the Supabase transaction pooler from
`DATABASE_URL`; `DIRECT_URL` is only for migrations, backups, and restores.
Transient read failures use bounded retries, while ambiguous writes are never
automatically replayed. Database outages return retryable `503` responses and
the readiness endpoint reports `checks.database=false`.

Supabase Free does not provide automatic database failover. Configure the
encrypted off-site backup workflow and run regular restore drills using
[`WESCOMM_DATABASE_RESILIENCE.md`](../txt_files/WESCOMM_DATABASE_RESILIENCE.md).

### Idempotent checkout

Run `../txt_files/DATABASE_RESERVATION_IDEMPOTENCY_SQL.txt` once in the Supabase SQL Editor. Student checkout must send a unique `Idempotency-Key` header between 16 and 128 characters. The frontend generates this automatically.

- Repeating the same key with the same checkout details returns the original reservation and does not deduct stock or send notifications twice.
- Reusing the key with changed items, quantity, options, payment, or pickup schedule returns `409 IDEMPOTENCY_KEY_REUSED`.
- Keys are scoped per student and retained for 24 hours. Expired records are cleaned when that student submits another checkout.
- A new reservation returns HTTP `201`; an idempotent replay returns HTTP `200` with `Idempotent-Replayed: true`.

Run the reservation safety suite with:

```powershell
npm run test:ci
```

The suite also covers reservation status transitions, stock-status derivation, cookie-origin CSRF policy, field encryption, and per-user rate limiting. Browser role and UX checks are documented in `../txt_files/WESCOMM_QA_STAGING_RUNBOOK.txt`.

## Database migrations

The Supabase database existed before Prisma Migrate was introduced. The
`0_init` migration is its Prisma-managed baseline; it must be recorded as
already applied once on every existing or externally bootstrapped database.

Before the one-time baseline, create a backup and confirm that the SQL bootstrap
above completed. Then run:

```powershell
cd backend
npm run prisma:migrate:baseline:existing
npm run prisma:migrate:deploy
npm run prisma:migrate:verify
npm run receipts:tokens:backfill
npm run receipts:integrity:audit
```

The baseline command first performs a read-only schema preflight. It refuses to
record `0_init` if required tables, columns, or enum values are missing, or if
the pending restriction index appears to have been manually applied already.

For every later release, do not baseline again. Run only:

```powershell
npm run prisma:migrate:deploy
npm run prisma:migrate:verify
```

### Receipt-integrity and distributed-rate-limit rollout

Before deploying `20260830000000_enforce_reservation_receipt_integrity`, run the
read-only invariant audit against a backup-restorable database:

```powershell
npm run receipts:integrity:audit
```

The audit exits non-zero whenever it finds any issue. Before deployment, the
`duplicateReservationReceipts` and `inconsistentReservationReceipts` arrays
must both be empty; resolve those financial records with an auditable business
decision. `completedWithoutReceipt` may remain for the guarded post-migration
repair described below. The migration refuses to continue while duplicate or
inconsistent linked receipts remain. Rerun the audit to confirm those two
blocking arrays are empty, then use the standard `prisma:migrate:deploy` and
`prisma:migrate:verify` commands. The following
`20260830010000_add_distributed_rate_limits` migration creates the server-only,
RLS-protected shared counter table used by production instances.

The deploy makes future completions atomic and lets an idempotent `COMPLETED`
replay repair an older missing receipt. To repair all audited legacy rows, first
run the repair command without flags to review its dry-run output. Apply mode is
guarded and requires both a real Staff/Admin actor UUID and the exact confirmation
value printed by the script; never point it at Production without a current
backup and an approved maintenance window.

### WesBot rollout

The WesBot support lifecycle requires the
`20260814000000_add_wesbot_support` migration. Roll it out in this order so the
previous backend remains compatible throughout the release:

1. Keep `WESBOT_ENABLED=false` and `WESBOT_AI_ENABLED=false`.
2. Run `npm run prisma:migrate:deploy`, then `npm run prisma:migrate:verify`.
3. Deploy the backend and frontend together through the root Vercel Services project.
4. Verify `/api/health/ready`, student Support, and the Staff Message Center.
5. Set `WESBOT_ENABLED=true` and redeploy. This enables deterministic,
   database-grounded replies without any model cost.

WesBot v2 semantic routing and wording polish are separate release toggles.
The reviewed v2 dataset is versioned under `datasets/wesbot/v2`; validate and
import it with:

```powershell
npm run wesbot:dataset:validate
npm run wesbot:import:dry-run
npm run wesbot:import:apply
npm run wesbot:import:verify
npm run wesbot:grounding:verify
```

FAQ imports are unpublished drafts. The importer deactivates only its exact,
reviewed junk product targets and unpublishes only its exact junk FAQ targets;
it never hard-deletes those records.

Keep `WESBOT_SEMANTIC_MODE=off` and `WESBOT_AI_REWRITE_ENABLED=false` for the
fast deterministic/database-grounded path. To evaluate semantic routing,
enable direct Gemini access (configure `GEMINI_API_KEY` server-side),
set `WESBOT_MODEL` to a Gemini model identifier, and run
`npm run wesbot:eval:semantic`. The evaluator is hard-capped at 300 calls and
uses only the versioned dataset. Use `shadow` in Preview first; promote to
`active` only after the holdout, context, clarification, and latency gates pass.
`WESBOT_AI_REWRITE_ENABLED` should remain false when semantic routing is active
so an ambiguous message needs at most one model call. Never expose a Gemini
credential to the frontend. If the classifier, Gemini API, or grounding lookup
fails, WesBot returns a safe clarification/fallback instead of inventing facts.

For a local evaluation without writing a Gemini credential to disk, run this
from the repository root after linking the project with Vercel:

```powershell
npx vercel env run -e development -- npm --prefix backend run wesbot:eval:semantic
```

This injects the configured Development environment variables into the evaluator process.
The evaluator performs one Gemini preflight first and stops immediately with a
sanitized diagnostic if authentication, billing, or model access is unavailable;
only a successful preflight proceeds through the full 81 dataset-only cases.

Never mark `20260718000000_enforce_single_active_restriction` as applied unless
its SQL was executed manually and its exact partial unique index was verified.
`migrate deploy` does not detect schema drift, and `db push` is not a production
migration workflow.

The Prisma baseline recreates the Prisma-managed structure for CI and local
PostgreSQL. It does not replace the Supabase SQL bootstrap for Auth triggers,
RLS policies, storage, Realtime, or platform-specific custom checks. Later
Prisma migrations may adopt or create application tables such as `audit_logs`.

## Student Reservation Access Policy

The active-restriction migration expires stale rows, deterministically resolves
any duplicate active restrictions, and adds the database-level invariant that
each student can have at most one `ACTIVE` restriction. It briefly blocks writes
to that table, so apply it during a low-traffic release window. Application
builds do not mutate the production database automatically.

The restriction affects reservation submission only. Students can still browse items, view receipts, use Support, and manage their profile.

- A no-show can only be confirmed from `READY_FOR_PICKUP` after the pickup deadline plus a 24-hour grace period.
- First confirmed no-show: warning.
- Second consecutive confirmed no-show: final warning.
- Third consecutive confirmed no-show: 7-day reservation restriction.
- The next confirmed no-show after access is restored escalates to 30 days; a later one escalates to an indefinite restriction pending admin review.
- A completed pickup resets the consecutive warning count.
- Staff can apply or lift temporary reservation restrictions. Only admins can apply/lift indefinite restrictions and overturn an offense.
- Restriction creation, lifting, offense reversal, reservation status changes, and stock restoration are audited.

## Staff Product Examples

Create product:

```json
{
  "name": "WUP Girls Uniform Set",
  "categoryName": "Uniforms",
  "description": "Official blouse and skirt set",
  "imageUrl": "/assets/wup shop assets/wup-girls-uniform-set.png",
  "price": 820,
  "stock": 24,
  "lowStockThreshold": 8,
  "variants": [
    { "optionName": "Size", "optionValue": "Small", "stock": 8 },
    { "optionName": "Size", "optionValue": "Medium", "stock": 10 },
    { "optionName": "Size", "optionValue": "Large", "stock": 6 }
  ]
}
```

Update product:

```json
{
  "price": 850,
  "stock": 30,
  "lowStockThreshold": 10,
  "notes": "Manual inventory count adjustment."
}
```

Restock product:

```json
{
  "mode": "add",
  "quantity": 20,
  "notes": "New delivery received."
}
```

Set exact stock:

```json
{
  "mode": "set",
  "quantity": 45,
  "notes": "Physical count correction."
}
```
