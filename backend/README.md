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

The browser exchanges its Supabase access token once through `POST /api/auth/session`, then uses a revocable HttpOnly cookie. Bearer tokens remain supported for trusted API testing.

## Security Configuration

Development test login is restricted to the exact emails in `AUTH_DEV_LOGIN_EMAILS`. It is rate-limited and the backend refuses to start when `AUTH_ENABLE_DEV_LOGIN=true` with `NODE_ENV=production`.

Recommended local values:

```env
NODE_ENV=development
AUTH_ENABLE_DEV_LOGIN=true
AUTH_DEV_LOGIN_EMAILS=student@wesleyan.edu.ph,staff@wesleyan.edu.ph,admin@wesleyan.edu.ph
AUTH_DEV_LOGIN_PASSWORD=USE_A_LOCAL_TEST_PASSWORD
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
DATA_ENCRYPTION_CURRENT_VERSION=v1
DATA_ENCRYPTION_KEYS=v1:YOUR_PRIVATE_32_BYTE_BASE64_KEY
```

The API applies request IDs, strict CORS, CSRF origin checks, security headers, no-store caching for authenticated data, action-specific rate limits, bounded request schemas, image signature validation, encrypted sensitive fields, revocable hashed sessions, privacy-safe push notifications, and privacy-safe public receipt verification. For a multi-instance deployment, replace the in-memory rate-limit store with a shared rate-limit store.

Never commit `.env`. Rotate any service-role, database, SMTP, or private VAPID credential that has been pasted into chat, screenshots, issues, or shared documents.

## Audit Logs

Admin activity tracking uses the `audit_logs` table from `DATABASE_AUDIT_LOGS_SQL.txt`. The backend records important actions such as product creation/update/archive/restock, product image upload, reservation status updates, receipt generation/verification, FAQ changes, support status updates, and admin user role changes.

Audit logs are best-effort during development. If the table is not created yet, normal operations continue, but `/api/admin/audit-logs` will show an error until the SQL file is run.

## Reservation Stock Safety

`POST /api/reservations` now uses a Prisma database transaction. The backend checks stock, creates the reservation, writes reservation items, deducts inventory, records inventory movement, and creates reservation/low-stock notifications as one atomic flow. If stock changes while a student is reserving, the API returns `409` and the reservation is not saved.

`PATCH /api/reservations/:id/status` also handles cancellation stock restoration inside a transaction, so cancelling a reservation restores stock and records the inventory movement together with the status change.

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
```

The baseline command first performs a read-only schema preflight. It refuses to
record `0_init` if required tables, columns, or enum values are missing, or if
the pending restriction index appears to have been manually applied already.

For every later release, do not baseline again. Run only:

```powershell
npm run prisma:migrate:deploy
npm run prisma:migrate:verify
```

Never mark `20260718000000_enforce_single_active_restriction` as applied unless
its SQL was executed manually and its exact partial unique index was verified.
`migrate deploy` does not detect schema drift, and `db push` is not a production
migration workflow.

The Prisma baseline recreates the Prisma-managed structure for CI and local
PostgreSQL. It does not replace the Supabase SQL bootstrap for Auth triggers,
RLS policies, storage, Realtime, custom checks, or `audit_logs`.

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
