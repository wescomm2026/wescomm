# WESCOMM Frontend

Responsive web frontend for the Wesleyan Commissary System.

## Stack

- Next.js 14 App Router
- Tailwind CSS
- shadcn/ui-style reusable components
- Supabase Auth client wiring
- Prisma / Supabase PostgreSQL schema starter
- Recharts analytics

## Routes

- `/student/dashboard`, `/student/shop`, `/student/reservations`, `/student/receipts`, `/student/faq`, `/student/support`, `/student/profile`
- `/staff/dashboard`, `/staff/inventory`, `/staff/reservations`, `/staff/receipt-verification`, `/staff/messages`, `/staff/faq-management`, `/staff/reports`, `/staff/settings`
- `/admin/dashboard`, `/admin/inventory`, `/admin/reservations`, `/admin/receipt-verification`, `/admin/messages`, `/admin/faq-management`, `/admin/reports`, `/admin/users`, `/admin/settings`

Mobile uses the same content with responsive layouts: cards stack, tables become list cards, charts become full width, and navigation uses a web header with hamburger menu.

## Browser QA

Playwright covers the public Shop, local cart behavior, mobile navigation, development-account login, logout, and student/staff/admin API boundaries.

```powershell
npm run test:e2e:install
$env:E2E_TEST_PASSWORD="<same value as backend AUTH_DEV_LOGIN_PASSWORD>"
npm run test:e2e
```

See `../txt_files/WESCOMM_QA_STAGING_RUNBOOK.txt` for the complete non-destructive and staging test procedure.
