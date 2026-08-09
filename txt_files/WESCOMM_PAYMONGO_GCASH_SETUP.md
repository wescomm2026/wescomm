# WesComm PayMongo GCash Setup Runbook

Last verified against official PayMongo documentation: **2026-08-01**

This runbook covers a GCash-only PayMongo integration for WesComm. Development starts in PayMongo Test Mode. Live payments must remain disabled until the school owns and approves the merchant account, policies, settlement account, and production configuration.

## Chosen architecture

Use **PayMongo Hosted Checkout API v2**. It is the current PayMongo recommendation for new hosted-checkout integrations and gives WesComm the smallest, safest integration surface.

1. The student checks out while signed in to WesComm.
2. The WesComm backend reloads the order or reservation, validates that it can still be paid, and calculates the amount from database prices. It never accepts a client-calculated total.
3. WesComm creates one reservation-level `OnlinePayment` and an immutable `OnlinePaymentAttempt` **before** contacting PayMongo. The attempt stores the exact request, request hash, attempt-specific idempotency key, and lifecycle state. Every returned Checkout Session is retained against its attempt.
4. The backend creates a PayMongo v2 Checkout Session with:
   - `payment_method_types: ["gcash"]`
   - PHP line items expressed in centavos
   - a unique WesComm `reference_number`
   - an opaque order/payment-attempt identifier in metadata
   - complete HTTPS `success_url` and `cancel_url` values
   - an `Idempotency-Key` stable for that payment attempt
5. WesComm saves the returned Checkout Session ID (`cs_...`), checkout URL, and local expiry before redirecting the browser to the PayMongo page as a top-level page. Do not embed it in an iframe.
6. GCash authorization happens on the provider-controlled page. PayMongo then redirects the browser back to WesComm.
7. WesComm changes the payment to `PAID` only after receiving and verifying `checkout_session.payment.paid`. A return URL, query parameter, browser message, GCash screenshot, or student claim is never payment proof.
8. In one short database transaction, WesComm records the provider IDs and amounts, updates the attempt and `OnlinePayment`, persists the webhook event, writes the financial audit row, and persists the in-app notification. Web Push is dispatched only after commit and is best-effort; it is not part of the exactly-once database guarantee.

Payment confirmation and fulfillment are deliberately separate. The webhook must not confirm the reservation, consume inventory again, create a WesComm receipt, or verify a receipt. Staff confirmation and pickup continue through the existing reservation flow. The existing completion flow creates the WesComm receipt only when the reservation reaches `COMPLETED`.

Hosted Checkout v2 defers Payment Intent creation until the student attempts payment. Save and reconcile by the Checkout Session ID, not by assuming a Payment Intent already exists.

### Core business safeguards

- Only the backend may calculate the payable amount.
- One reservation may have many historical attempts but at most one open attempt at a time. Provider Checkout Session IDs are globally unique across attempts.
- Repeated clicks or network retries must reuse the same local payment attempt and PayMongo idempotency key.
- `cancel_url` only returns the browser to WesComm; it does not cancel or expire the PayMongo session.
- A Checkout Session has a configurable local hold window. Once the final/current provider session is expired after that window, WesComm atomically cancels the still-pending reservation and restores its exact product and variant stock once. A different open or paid attempt prevents that cancellation.
- Cancellation first commits the local cancellation, stock restoration, and provider-expiry intent; PayMongo expiration then runs outside the transaction and maintenance retries it.
- When any attempt becomes paid, every other open attempt is durably marked for cleanup before acknowledgment and then expired best-effort.
- If a paid webhook arrives after an order was cancelled or its hold expired, do not silently fulfill or discard it. Move it to `REFUND_REVIEW_REQUIRED`; no refund money movement is automatic.
- An unknown provider-create outcome reuses the exact saved request and idempotency key only during WesComm's first 23 hours. This leaves a one-hour safety margin before PayMongo's 24-hour key expiry so an in-flight recovery cannot cross the provider boundary. A later 4xx or authentication rejection does not prove that an earlier ambiguous request created nothing, so the attempt stays unknown and never rotates to a new key. At 23 hours it is quarantined for manual review, the reservation hold is released when safe, and WesComm must not claim that a new checkout is safe.
- Payment and refund records are financial history. Correct them with explicit status changes or adjustment records; do not erase them.
- Never accept an uploaded GCash screenshot as official proof of payment.
- A paid online payment does not mean the item was confirmed, released, picked up, or completed. Those remain staff-controlled business steps.

## Backend environment variables

Use exactly these server-side variables unless the implementation is deliberately revised and this runbook is updated at the same time:

```dotenv
PAYMONGO_ENABLED=false
PAYMONGO_SECRET_KEY=sk_test_REPLACE_IN_SECRET_STORE
PAYMONGO_WEBHOOK_SECRET=whsk_REPLACE_IN_SECRET_STORE
PAYMONGO_LIVEMODE=false
PAYMONGO_RETURN_ORIGIN=https://staging.example.edu.ph
PAYMONGO_CHECKOUT_TTL_MINUTES=30
PAYMENT_MAINTENANCE_SECRET=REPLACE_WITH_AT_LEAST_32_RANDOM_CHARACTERS
```

| Variable | Required behavior |
| --- | --- |
| `PAYMONGO_ENABLED` | Kill switch for creating new Checkout Sessions. Default to `false`. Disabling it must not disable webhook handling for already-open sessions. |
| `PAYMONGO_SECRET_KEY` | PayMongo server secret. Use `sk_test_...` outside production and `sk_live_...` only in production. Never expose it to the frontend. |
| `PAYMONGO_WEBHOOK_SECRET` | Signing secret for the webhook endpoint, normally prefixed `whsk_...`. It is separate from the API secret. |
| `PAYMONGO_LIVEMODE` | Expected environment guard. `false` for test and `true` for live. Reject or quarantine webhook events whose `livemode` value does not match. |
| `PAYMONGO_RETURN_ORIGIN` | Exact trusted HTTPS origin used to build success and cancel URLs. Do not derive it from the incoming `Host`, `Origin`, or redirect query parameters. Do not include a trailing slash. |
| `PAYMONGO_CHECKOUT_TTL_MINUTES` | Local Checkout Session and inventory-hold window, from 5 to 1,440 minutes. WesComm defaults to 30 minutes. |
| `PAYMENT_MAINTENANCE_SECRET` | Server-only bearer secret for `POST /api/payments/maintenance`. It must contain at least 32 characters, is mandatory whenever PayMongo is enabled in Production, and must never be exposed to browser code. |

Hosted Checkout is created entirely by the backend, so WesComm does not need a browser-exposed PayMongo public key for this design.

### Secret handling

- Put secrets in local untracked environment files and the deployment platform's encrypted environment-variable store.
- Never place test or live keys, webhook secrets, raw webhook bodies, or full PayMongo responses in Git, issues, chat, presentation images, screenshots, or client bundles.
- `.env.example` may contain variable names and safe placeholders only.
- Restrict live-secret access to the institution's authorized owner and the smallest necessary technical group.
- Sanitize logs. Prefer event ID, Checkout Session ID, internal reference, result, and timestamp; avoid customer details and complete payloads.

## Test and live separation

| Setting | Test or staging | Production |
| --- | --- | --- |
| API key | `sk_test_...` | `sk_live_...` |
| Webhook secret | Test endpoint secret | Live endpoint secret |
| `PAYMONGO_LIVEMODE` | `false` | `true` |
| `PAYMONGO_RETURN_ORIGIN` | Staging HTTPS origin | Production HTTPS origin |
| Webhook URL | Staging `/api/webhooks/paymongo` | Production `/api/webhooks/paymongo` |
| Money movement | Simulated; no real GCash account or money | Real transactions and fees |

Register separate PayMongo webhook endpoints for staging and production. Never point a test-mode webhook at the production database or reuse one webhook secret across environments.

At application startup, fail closed if any of these are inconsistent:

- `PAYMONGO_ENABLED=true` but a required variable is missing.
- `PAYMONGO_LIVEMODE=false` with an `sk_live_` key.
- `PAYMONGO_LIVEMODE=true` with an `sk_test_` key.
- `PAYMONGO_RETURN_ORIGIN` is not an approved HTTPS origin in production.

## PayMongo account ownership and activation

### Test mode

- Create the PayMongo account and complete the identity steps required to obtain test keys.
- Test e-wallet authorization uses a PayMongo simulation page. Choose **Authorize** or **Fail**; no real GCash account or money is needed.
- Development access does not authorize live collection on behalf of Wesleyan.

### Live mode

The live merchant must belong to the institution or its legally authorized operating entity. Do not use a student's, developer's, adviser's, or group member's personal PayMongo or GCash account.

Before live GCash can be enabled:

1. The institution selects its correct legal entity type and authorized representative.
2. It completes identity verification, business verification, and all documents requested in the current PayMongo Dashboard.
3. The settlement bank account is institutionally owned and approved by finance.
4. The PayMongo Wallet is enabled.
5. GCash is requested under **Settings > Payment Methods** and reaches `Active` status.

PayMongo currently lists GCash as unavailable to Individual accounts, with or without a website. It is listed for Sole Proprietor, Partnership, Corporation, and One Person Corporation accounts, subject to provider approval. The published estimate for GCash activation is 3-7 business days, but the Dashboard and PayMongo review result control.

## Checkout endpoint requirements

The authenticated WesComm endpoint that starts payment should:

1. Require the student session and apply rate limiting.
2. Load the order, student, line items, prices, stock hold, and current status from the database.
3. Reject an already-paid, cancelled, manual-review, mismatched, or unauthorized order. An expired provider attempt may retry only while the reservation itself remains pending.
4. Reuse an existing valid active session instead of creating a duplicate.
5. Persist the immutable attempt and exact request before the provider call. Move the payment to `AWAITING_PAYMENT` only after the PayMongo Checkout Session ID, trusted URL, and local expiry are stored.
6. Send `POST https://api.paymongo.com/v2/checkout_sessions` using HTTP Basic authentication with the secret key as username and an empty password.
7. Include `Content-Type: application/json` and `Idempotency-Key: <stable-payment-attempt-key>`.
8. Save every returned `cs_...` ID before deciding whether to return or immediately expire its URL.

Conceptual request attributes:

```json
{
  "data": {
    "attributes": {
      "line_items": [
        {
          "name": "WesComm order item",
          "amount": 10000,
          "currency": "PHP",
          "quantity": 1
        }
      ],
      "payment_method_types": ["gcash"],
      "success_url": "${PAYMONGO_RETURN_ORIGIN}/student/payments/ONLINE_PAYMENT_ID?result=success",
      "cancel_url": "${PAYMONGO_RETURN_ORIGIN}/student/payments/ONLINE_PAYMENT_ID?result=cancelled",
      "reference_number": "WSC-UNIQUE-INTERNAL-REFERENCE",
      "send_email_receipt": false,
      "metadata": {
        "reservation_id": "RESERVATION_UUID",
        "online_payment_id": "ONLINE_PAYMENT_UUID",
        "online_payment_attempt_id": "PAYMENT_ATTEMPT_UUID"
      }
    }
  }
}
```

The current implementation does not send `pass_on_fees`; students are charged only the database-derived reservation line-item total. Any future fee pass-through requires explicit Wesleyan approval, checkout disclosure, code and test changes, and a runbook update.

GCash transactions are PHP-only for this integration. Amounts are integers in centavos. The currently documented e-wallet limits are **PHP 1.00 minimum** and **PHP 100,000.00 maximum per transaction**; a student's GCash account may have a lower limit.

## Webhook registration and verification

Deploy this public HTTPS route:

```text
POST /api/webhooks/paymongo
```

In the appropriate Test or Live PayMongo Dashboard environment:

1. Open **Developer Tools > Webhooks**.
2. Add the environment-specific absolute URL, for example `https://staging.example.edu.ph/api/webhooks/paymongo`.
3. Subscribe to `checkout_session.payment.paid`.
4. Store the displayed webhook signing secret as `PAYMONGO_WEBHOOK_SECRET` in that environment only.
5. Send a test event or complete a sandbox checkout and inspect the delivery log.

### Required signature check

Use the raw request bytes before JSON parsing.

1. Read the case-insensitive `Paymongo-Signature` header.
2. Parse its `t`, `te`, and `li` values.
3. Build the signed text as `<t>.<raw-json-body>`.
4. Compute HMAC-SHA256 using `PAYMONGO_WEBHOOK_SECRET`.
5. Compare with `te` in test mode or `li` in live mode using a constant-time comparison.
6. Reject invalid, missing, wrong-mode, or stale signatures before touching payment data.
7. Parse JSON only after signature verification.

PayMongo recommends checking timestamp freshness but does not publish a fixed tolerance. WesComm adopts **300 seconds** as its replay-protection policy; this is a WesComm setting, not a PayMongo-published requirement. Keep server time synchronized.

The official documentation currently contains simplified examples whose header or event-envelope shape differs from the detailed webhook setup and Hosted Checkout v2 examples. Before production, capture a genuine sandbox delivery, preserve its raw bytes, and lock automated tests to the actual signed header and v2 payload while accepting only the explicitly validated envelope shape.

### Safe event processing

- Persist each verified event ID in a table with a unique constraint. A repeated event must return success without repeating business effects.
- Resolve the signed attempt metadata, then require that the Checkout Session ID belongs to that persisted attempt and payment. A paid event from an older persisted attempt is still valid and must not be rejected merely because a newer attempt became current.
- Require the expected environment, event type, PHP currency, exact centavo amount, and GCash payment source.
- Store the provider payment ID with a unique constraint.
- In one database transaction, persist the event, attempt/payment transition, financial audit row, and deduplicated in-app notification. This is the exactly-once boundary. Web Push happens after commit and may be skipped or retried without changing financial state.
- Do not advance the reservation, consume inventory, create a WesComm receipt, or auto-verify any receipt in the webhook handler. Staff confirmation, pickup, completion, and receipt creation remain in the existing fulfillment flow.
- Return a 2xx response promptly after the event is durably accepted. Return a retryable server error if durable acceptance fails.
- Do not assume PayMongo will re-send a missed webhook event. Treat the webhook as a prompt notification path, monitor delivery status, and rely on authenticated Checkout Session reconciliation to recover provider-paid/local-unpaid records.

## Sandbox acceptance tests

All tests below must pass before live keys are added.

| Test | Expected result |
| --- | --- |
| Authorize GCash | Exactly one `OnlinePayment` becomes `PAID`; its payment audit and notification occur once; exact amount and mode match. Reservation status, inventory, and WesComm receipt remain unchanged until the normal staff/pickup/completion flow. |
| Fail GCash | `OnlinePayment` remains `AWAITING_PAYMENT`; no paid audit or payment-success notification is created, and fulfillment remains unchanged. Retry follows the approved checkout policy. |
| Cancel or close checkout | Return page shows unpaid/cancelled; it never marks paid. Local cancellation and exact stock restoration commit once, then every open provider attempt is expired or left with durable cleanup intent for maintenance. |
| Forge the success return URL | Directly visiting or editing the success URL cannot mark an order paid. |
| Duplicate checkout click | The same active session/payment attempt is returned; no duplicate provider session or stock hold is created. |
| Duplicate webhook | Replaying the same signed event causes no duplicate payment transition, payment audit, or notification. It never changes fulfillment, inventory, or WesComm receipts. |
| Invalid signature | Request is rejected and produces no financial or order change. |
| Amount mismatch | Event is quarantined and alerted; payment/order is not automatically fulfilled. |
| Currency, source, or mode mismatch | Event is quarantined and alerted; test data can never alter live orders. |
| Webhooks arrive out of order | State only moves through allowed transitions; an older event cannot undo a paid state. |
| Webhook downtime | Do not assume replay. Scheduled or staff-triggered reconciliation retrieves the Checkout Session/payment and safely applies any valid paid state that was not processed locally. |
| App/database failure during processing | Transaction rollback leaves no partially applied payment/audit/notification result; reconciliation later completes a valid payment confirmation exactly once without touching fulfillment. |
| Stale paid session race | A payment received after cancellation is flagged for staff review/refund instead of silently fulfilled or lost. |
| Final hold expiry | After the configured window and provider expiration, the final pending reservation is cancelled and exact product/variant stock is restored once. A different open/paid attempt prevents cancellation. |
| Unknown create outcome | For less than 23 hours, the exact saved request/key recovers the same session. A later 4xx/auth response cannot downgrade an already-unknown attempt to failed. At 23 hours it is quarantined, leaving a one-hour margin before the provider key expires; staff/admin are alerted and no new online checkout is advertised as safe. Any invalid or unparseable HTTP 2xx create response is also treated as unknown, never as proof that creation failed. |
| Fee/net fields | Each provider value is an integer within 0..amount. WesComm does not require `fee + net_amount = amount`, because additional provider deductions may be represented separately. |
| Refund exercise | `REFUND_REVIEW_REQUIRED` creates a manual finance/staff case only. No refund request or money movement occurs automatically in the current release. |

For test e-wallet payments, open the PayMongo test redirect page and exercise both **Authorize** and **Fail**. Do not scan or submit a real GCash payment during sandbox testing.

## Reconciliation and operations

WesComm exposes two reconciliation paths:

- `POST /api/payments/:paymentId/reconcile` is authenticated and limited to staff/admin for manual investigation.
- `GET /api/payments/:paymentId` may claim one stale attempt for a student-side check, but a database timestamp claim throttles this to one provider lookup per attempt per 15 seconds across instances.

The bounded maintenance endpoint is:

```text
POST /api/payments/maintenance
Authorization: Bearer <PAYMENT_MAINTENANCE_SECRET>
Content-Type: application/json

{"limit":25}
```

It fails closed when the secret is absent, compares a hashed bearer token in constant time, accepts only limits from 1 to 50, and records scheduled/system audit rows with a null actor instead of inventing a profile UUID. Production startup also fails when PayMongo is enabled without this secret. It performs provider calls outside database transactions.

`.github/workflows/payment-maintenance.yml` invokes this endpoint approximately hourly through GitHub Actions `schedule` and `workflow_dispatch`. Configure these encrypted repository secrets:

- `WESCOMM_PAYMENT_MAINTENANCE_URL` = the full production HTTPS URL ending in `/api/payments/maintenance`
- `WESCOMM_PAYMENT_MAINTENANCE_SECRET` = the same value as the backend's `PAYMENT_MAINTENANCE_SECRET`

GitHub explicitly does not guarantee an exact start time, so the backend decides eligibility from persisted timestamps and each call handles a bounded batch. Run `workflow_dispatch` after an outage or until `examined` reaches zero. Do not rely on an hourly Vercel Hobby cron; its free-plan schedule is not frequent enough for a 30-minute hold.

Each maintenance pass:

1. Retries recent `CREATING`, `CREATE_UNKNOWN`, and session-less cleanup attempts with their exact stored request and same idempotency key only during the first 23 hours.
2. Quarantines unknown outcomes at 23 hours -- one hour before the provider key expires -- for staff review, blocks a new online checkout, and releases a pending reservation's stock atomically when no other open/paid attempt exists.
3. Retrieves known Checkout Sessions with `GET /v1/checkout_sessions/:id` and applies the same session, metadata, reference, mode, PHP amount, GCash source, provider-ID, and timestamp checks used by the webhook.
4. Expires sessions through `POST /v1/checkout_sessions/:id/expire` when their hold ended, cancellation committed, or another attempt paid.
5. Rechecks a non-expirable session because PayMongo may reject expiry when it is already expired, paid, or processing.
6. Applies a missing verified payment through the same atomic transition used by webhooks and produces audit/manual-review records for mismatches. Screenshots never clear exceptions.

Operators should monitor:

- PayMongo webhook delivery logs and endpoint enabled/disabled status
- WesComm invalid-signature and mismatch alerts
- old `INITIALIZING` or `AWAITING_PAYMENT` payments
- provider-paid/local-unpaid discrepancies
- duplicate-session attempts
- refunds awaiting completion
- settlement and payout reconciliation

Reconciliation is required, not optional: PayMongo's official Webhooks Resource says missed webhook events are not re-sent.

## Refund and no-show handling

The current WesComm release does **not** call the PayMongo Refund API and does not move money automatically. `REFUND_REVIEW_REQUIRED` means an authorized staff/finance person must verify the provider state and follow the school-approved procedure. Do not label this state as a pending refund because that would falsely claim that a provider refund request had already been submitted.

Only a PayMongo payment with `paid` status may be refunded. The API uses `POST /v1/refunds` with the provider `payment_id`, amount in centavos, and an approved reason. Use an idempotency key and record the local refund request before contacting PayMongo.

PayMongo currently documents GCash refunds as:

- full or partial refunds supported
- request window up to 180 days after payment
- expected reflection within 24 hours
- subject to sufficient upcoming payout balance

The exact event names offered for refund updates must be confirmed in the current Dashboard because current official pages are inconsistent (`refund.succeeded` versus older `payment.refunded` / `payment.refund.updated` naming). Do not enable automatic refund-state changes until a real sandbox or controlled live event has validated the subscribed name and payload.

Before live launch, Wesleyan must approve and publish:

- who may request and approve refunds
- full versus partial refund conditions
- treatment of processing fees
- order cancellation deadline
- no-show consequences for paid reservations
- stock restoration timing
- expected refund timeline and student support channel
- accounting, official receipt, and audit requirements

Do not automatically forfeit, refund, or transfer a no-show payment until the school-approved policy and student disclosure are in place.

## Go-live gates

Live payment remains blocked unless every item is complete:

- [ ] Wesleyan approves online GCash as part of WesComm's formal scope.
- [ ] The school approves checkout, cancellation, refund, no-show, privacy, receipt, settlement, and support policies.
- [ ] The institution owns the verified PayMongo merchant and settlement accounts.
- [ ] PayMongo Wallet is enabled and GCash shows `Active` in Live Mode.
- [ ] All sandbox tests in this runbook pass with evidence that contains no secrets.
- [ ] Database uniqueness, allowed-status transitions, and transaction boundaries are tested.
- [ ] Production secrets are stored only in the deployment secret store.
- [ ] Production `PAYMONGO_RETURN_ORIGIN` is the exact HTTPS site origin.
- [ ] The live webhook endpoint is registered separately and its signature is verified end to end.
- [ ] Monitoring, reconciliation, refund permissions, and staff procedures are operational.
- [ ] A controlled low-value live GCash smoke payment succeeds and is reconciled.
- [ ] The smoke payment refund is tested only with finance approval.
- [ ] Presentation, scope, data model, privacy notice, and user instructions reflect online payment.
- [ ] `PAYMONGO_ENABLED` is turned on only after final institutional approval.

Rollback procedure: set `PAYMONGO_ENABLED=false` to stop new sessions, but keep the webhook endpoint operating so already-open or recently paid sessions can still be recorded and reconciled.

## Key rotation and incident response

### Planned rotation

1. Announce a maintenance window and keep the feature flag available.
2. Create or reveal the replacement secret through the PayMongo Dashboard's supported rotation flow.
3. Update the deployment secret store, redeploy, and run a test or controlled payment.
4. Confirm webhook delivery and reconciliation before revoking the old credential.
5. Record who rotated the key, when, which environment, and the validation result without recording the key itself.

### Suspected API-key exposure

1. Set `PAYMONGO_ENABLED=false` and deploy immediately.
2. Rotate the affected PayMongo API key in the Dashboard.
3. Replace it in the correct deployment environment and redeploy.
4. Revoke the old key. Deleting it from a Git file or message does not undo exposure.
5. Review PayMongo transactions, API activity, application logs, and deployments from the earliest possible exposure time.
6. Reconcile all affected payment attempts and notify Wesleyan's authorized incident owner.
7. Restore checkout only after controlled verification.

### Suspected webhook-secret exposure

1. Keep new checkout disabled until webhook authenticity is restored.
2. Rotate or replace the affected webhook endpoint/signing secret using the Dashboard-supported flow.
3. Update `PAYMONGO_WEBHOOK_SECRET`, redeploy, and verify a genuine event.
4. Review invalid or suspicious events and reconcile every affected payment with PayMongo.
5. Re-enable payment only after the endpoint rejects forged requests and accepts genuine ones.

Never paste a secret into a ticket, chat, screenshot, commit, presentation, or incident report.

## Current cost note

As of **2026-08-01**, PayMongo publishes the following Standard Payments pricing:

- setup fee: free
- standard monthly fee: none
- GCash: **2.23% per successful transaction, exclusive of VAT**
- test transactions: simulated; no real money moves

Optional PayMongo products, premium support, instant settlement, transfers, and other add-ons may have separate charges. Confirm the current pricing page and the institution's PayMongo agreement immediately before live launch. Do not promise that all PayMongo services are free.

## Official PayMongo sources

- [Hosted Checkout overview and v2 recommendation](https://docs.paymongo.com/docs/payment-channels-hosted-checkout)
- [Create Checkout Session v2 API reference](https://docs.paymongo.com/reference/create_checkout_sessions_2)
- [Retrieve Checkout Session API reference](https://docs.paymongo.com/reference/get_checkout_sessions)
- [Expire Checkout Session API reference](https://docs.paymongo.com/reference/create_checkout_sessions_id_expire)
- [Hosted Checkout quick start](https://docs.paymongo.com/docs/payment-channels-hosted-checkout-quick-start)
- [Checkout lifecycle and webhook event](https://docs.paymongo.com/docs/payment-channels-key-concepts)
- [Payment-channel best practices](https://docs.paymongo.com/docs/payment-channels-best-practices)
- [GCash and other e-wallet behavior and limits](https://docs.paymongo.com/docs/payment-acceptance-e-wallets)
- [Payment Acceptance test mode](https://docs.paymongo.com/docs/payment-acceptance-testing)
- [Hosted Checkout test mode](https://docs.paymongo.com/docs/payment-channels-testing)
- [Webhook setup and signature verification](https://docs.paymongo.com/docs/developer-tools-webhook-setup-management)
- [Webhook delivery behavior and event list](https://docs.paymongo.com/reference/webhook-resource)
- [Webhook event payload examples](https://docs.paymongo.com/docs/developer-tools-webhooks-events)
- [Idempotent request behavior](https://docs.paymongo.com/reference/idempotent-requests)
- [Refund process and GCash refund window](https://docs.paymongo.com/docs/payment-acceptance-refunds)
- [Account capability and GCash eligibility](https://docs.paymongo.com/docs/account-settings-account-capabilities)
- [Institutional verification requirements](https://docs.paymongo.com/docs/account-settings-verification-requirements)
- [Current PayMongo pricing](https://www.paymongo.com/pricing)
