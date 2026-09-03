import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function source(relativePath: string) {
  return readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

test("reservation cancellation persists provider cleanup intent before best-effort expiry", () => {
  const reservation = source("src/services/reservation.service.ts");
  assert.match(reservation, /status === "CANCELLED"[\s\S]*onlinePaymentAttempt\.updateMany[\s\S]*status: "EXPIRY_REQUESTED"/);
  assert.match(reservation, /expireRequestedAt: new Date\(\)/);
  assert.match(reservation, /await Promise\.allSettled\([\s\S]*expireCheckoutAttemptBestEffort/);
});

test("final checkout expiry cancels and restores held inventory exactly once", () => {
  const reconciliation = source("src/services/paymongo-reconciliation.service.ts");
  assert.match(reconciliation, /reservation\.updateMany\([\s\S]*status: "PENDING"[\s\S]*status: "CANCELLED"/);
  assert.match(reconciliation, /cancelled\.count !== 1/);
  assert.match(reconciliation, /type: "RESERVATION_CANCEL"[\s\S]*previousStock[\s\S]*newStock/);
  assert.match(reconciliation, /otherOpenOrPaidAttempt[\s\S]*!otherOpenOrPaidAttempt/);
  assert.match(reconciliation, /checkoutExpiresAt <= now/);
  assert.match(reconciliation, /reservationCancelled[\s\S]*\? "CANCELLED" as const[\s\S]*: shouldExpirePayment \? "EXPIRED"/);
});

test("automatic cancellation restores variants from exact hold-ledger IDs or stops for review", () => {
  const reconciliation = source("src/services/paymongo-reconciliation.service.ts");
  assert.match(reconciliation, /inventoryMovement\.findMany\([\s\S]*type: "RESERVATION_HOLD"[\s\S]*notes: \{ startsWith: holdNote \}/);
  assert.match(reconciliation, /movement\.variantId !== movement\.variant\.id/);
  assert.match(reconciliation, /variantRelease\.set\(variant\.id/);
  assert.match(reconciliation, /status: "MANUAL_REVIEW_REQUIRED"/);
  assert.match(reconciliation, /VARIANT_HOLD_LEDGER_MISMATCH/);
  assert.match(reconciliation, /ONLINE_PAYMENT_INVENTORY_REVIEW_REQUIRED/);
  assert.doesNotMatch(reconciliation, /function aggregateVariantRelease/);
});

test("unknown provider creates are recovered only inside the key window and otherwise quarantined", () => {
  const reconciliation = source("src/services/paymongo-reconciliation.service.ts");
  const payment = source("src/services/payment.service.ts");
  assert.match(reconciliation, /recoverPaymongoCheckoutSessionFromRequest\([\s\S]*providerIdempotencyKey[\s\S]*request/);
  const domain = source("src/domain/online-payment.ts");
  assert.match(domain, /PAYMONGO_PROVIDER_IDEMPOTENCY_WINDOW_MS = 24 \* 60 \* 60 \* 1000/);
  assert.match(domain, /PAYMONGO_CREATE_RECOVERY_SAFETY_MARGIN_MS = 60 \* 60 \* 1000/);
  assert.match(domain, /PAYMONGO_CREATE_RECOVERY_WINDOW_MS =[\s\S]*PAYMONGO_PROVIDER_IDEMPOTENCY_WINDOW_MS - PAYMONGO_CREATE_RECOVERY_SAFETY_MARGIN_MS/);
  assert.match(reconciliation, /createdAt: \{ lte: safeRecoveryCutoff \}/);
  assert.match(reconciliation, /status: "MANUAL_REVIEW_REQUIRED"/);
  assert.match(reconciliation, /Do not retry this checkout/);
  assert.match(payment, /kind: "QUARANTINE"[\s\S]*quarantineUnknownAttempt/);
  assert.match(payment, /status: "CREATING"[\s\S]*status: "FAILED"[\s\S]*status: "CREATE_UNKNOWN"[\s\S]*lastProviderErrorCode/);
  assert.match(reconciliation, /later definitive response[\s\S]*retain uncertainty[\s\S]*status: initial\.status === "EXPIRY_REQUESTED" \? "EXPIRY_REQUESTED" : "CREATE_UNKNOWN"/);
  assert.doesNotMatch(`${payment}\n${reconciliation}`, /safely start a new checkout/i);
});

test("checkout finalization cannot extend an old attempt or copy aggregate PAID onto a different attempt", () => {
  const payment = source("src/services/payment.service.ts");
  const reconciliation = source("src/services/paymongo-reconciliation.service.ts");
  assert.match(payment, /attempt\.createdAt\.getTime\(\) \+ env\.PAYMONGO_CHECKOUT_TTL_MINUTES/);
  assert.match(payment, /const localExpired = checkoutExpiresAt <= now/);
  assert.match(payment, /const attemptAlreadyPaid = attempt\.status === "PAID"/);
  assert.match(payment, /const paidByAnotherAttempt = payment\.status === "PAID" && !attemptAlreadyPaid/);
  assert.match(payment, /paidByAnotherAttempt[\s\S]*"EXPIRY_REQUESTED" as const/);
  assert.match(reconciliation, /const attemptAlreadyPaid = current\.status === "PAID"[\s\S]*const paidByAnotherAttempt = payment\.status === "PAID" && !attemptAlreadyPaid/);
  assert.match(reconciliation, /status: attemptAlreadyPaid \? "PAID" : shouldExpire \? "EXPIRY_REQUESTED" : "ACTIVE"/);
});

test("a salvaged create-response ID is verified by GET before its URL is trusted or it is expired", () => {
  const client = source("src/services/paymongo-client.ts");
  const payment = source("src/services/payment.service.ts");
  const reconciliation = source("src/services/paymongo-reconciliation.service.ts");
  assert.match(client, /providerCheckoutSessionId: identity\.data\.data\.id/);
  assert.match(payment, /partialSessionId[\s\S]*providerCheckoutSessionId: partialSessionId/);
  assert.match(reconciliation, /if \(!attempt\.checkoutUrl\)[\s\S]*reconcileCheckoutAttemptInternal\([\s\S]*allowExpiration: false/);
  assert.match(reconciliation, /getPaymongoCheckoutSession\(initial\.providerCheckoutSessionId\)/);
  assert.match(reconciliation, /checkoutUrl: providerSession\.checkoutUrl[\s\S]*ONLINE_PAYMENT_ATTEMPT_IDENTITY_RECOVERED/);
  assert.match(reconciliation, /"CREATING", "CREATE_UNKNOWN", "ACTIVE", "EXPIRY_REQUESTED", "EXPIRED"/);
});

test("persistent known-session provider failures become a bounded durable review case", () => {
  const reconciliation = source("src/services/paymongo-reconciliation.service.ts");
  assert.match(reconciliation, /PROVIDER_FAILURE_REVIEW_DELAY_MS = 24 \* 60 \* 60 \* 1000/);
  assert.match(reconciliation, /quarantineKnownProviderAttempt[\s\S]*"CREATING", "CREATE_UNKNOWN", "EXPIRY_REQUESTED"/);
  assert.match(reconciliation, /status: "MANUAL_REVIEW_REQUIRED"[\s\S]*ONLINE_PAYMENT_PROVIDER_REVIEW_REQUIRED/);
  assert.match(reconciliation, /reservationCancelled: false[\s\S]*stockReleased: false/);
});

test("aggregate paid fields consistently describe the latest charge under refund review", () => {
  const transition = source("src/services/paymongo-payment-transition.service.ts");
  assert.match(transition, /providerPaymentId: verified\.payment\.id[\s\S]*feeCentavos: verified\.payment\.feeCentavos[\s\S]*paidAt: verified\.paidAt/);
  assert.doesNotMatch(transition, /paidAt: onlinePayment\.paidAt \?\?/);
});

test("explicit reservation cancellation closes an expired aggregate payment", () => {
  const reservation = source("src/services/reservation.service.ts");
  assert.match(reservation, /onlinePayment\.status === "INITIALIZING"[\s\S]*onlinePayment\.status === "AWAITING_PAYMENT"[\s\S]*onlinePayment\.status === "EXPIRED"[\s\S]*status: "CANCELLED"/);
});

test("a paid attempt durably schedules every other open attempt for expiration", () => {
  const transition = source("src/services/paymongo-payment-transition.service.ts");
  assert.match(transition, /id: \{ not: attempt\.id \}[\s\S]*"CREATING", "CREATE_UNKNOWN", "ACTIVE", "EXPIRY_REQUESTED"/);
  assert.match(transition, /onlinePaymentAttempt\.updateMany\([\s\S]*status: "EXPIRY_REQUESTED"[\s\S]*expireRequestedAt/);
  assert.match(transition, /cleanupAttemptIds/);
});

test("a serialization loser rechecks durable webhook deduplication before asking for retry", () => {
  const webhook = source("src/services/paymongo-webhook.service.ts");
  assert.match(webhook, /error\.code === "P2034"[\s\S]*paymongoWebhookEvent\.findUnique\([\s\S]*where: \{ dedupeKey \}[\s\S]*committedDuplicate/);
});

test("maintenance is bearer-protected, bounded, and scheduled externally", () => {
  const routes = source("src/routes/payments.routes.ts");
  const workflow = source("../.github/workflows/payment-maintenance.yml");
  assert.match(routes, /PAYMENT_MAINTENANCE_SECRET/);
  assert.match(routes, /timingSafeEqual/);
  assert.match(routes, /z\.number\(\)\.int\(\)\.min\(1\)\.max\(50\)/);
  assert.match(routes, /"\/maintenance",\s*requireMaintenanceSecret,\s*maintenanceLimiter/);
  assert.match(source("src/config/env.ts"), /PAYMONGO_ENABLED[\s\S]*isProductionDeployment[\s\S]*PAYMENT_MAINTENANCE_SECRET/);
  assert.match(source("src/services/paymongo-reconciliation.service.ts"), /input\.limit - quarantinable\.length/);
  assert.match(workflow, /cron: "7,22,37,52 \* \* \* \*"/);
  assert.match(workflow, /WESCOMM_PAYMENT_MAINTENANCE_SECRET/);
  assert.match(workflow, /workflow_dispatch/);
  assert.match(workflow, /https:\/\/\*\/api\/payments\/maintenance/);
  assert.match(workflow, /--proto-redir =https/);
});
