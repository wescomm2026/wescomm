import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function source(relativePath: string) {
  return readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

test("PayMongo receives the raw request body before JSON and CSRF middleware", () => {
  const app = source("src/app.ts");
  const webhookIndex = app.indexOf('"/api/webhooks/paymongo"');
  const jsonIndex = app.indexOf('app.use(express.json({ limit: "6mb" }))');
  const csrfIndex = app.indexOf("app.use(requireTrustedCookieOrigin)");

  assert.ok(webhookIndex >= 0, "raw PayMongo route must be mounted");
  assert.ok(webhookIndex < jsonIndex, "raw PayMongo route must precede the JSON parser");
  assert.ok(webhookIndex < csrfIndex, "provider webhook must precede browser CSRF middleware");
  assert.match(app, /express\.raw\(\{ type: "application\/json", limit: "256kb" \}\)/);
  assert.match(app, /allowedHeaders: \[[^\]]*"Idempotency-Key"/);
});

test("checkout kill switch does not disable signed webhook confirmations", () => {
  const route = source("src/routes/paymongo-webhook.routes.ts");
  assert.match(route, /if \(!env\.PAYMONGO_WEBHOOK_SECRET\)/);
  assert.doesNotMatch(route, /PAYMONGO_ENABLED/);
});

test("signed foreign events are ignored and recognized mismatches are durably quarantined", () => {
  const service = source("src/services/paymongo-webhook.service.ts");
  assert.match(service, /status: "IGNORED"/);
  assert.match(service, /status: "REJECTED"/);
  assert.match(service, /reasonCode: validation\.reasonCode/);
  assert.match(service, /acknowledged: true[^\n]*processed: false[^\n]*rejected: true/);
  assert.doesNotMatch(service, /rawBody|JSON\.stringify\(input\.event/);
});

test("reservation fulfillment is gated by a paid online payment and exposes the singular payment alias", () => {
  const reservationService = source("src/services/reservation.service.ts");
  assert.match(reservationService, /assertPaymentAllowsReservationTransition\(/);
  assert.match(reservationService, /payment:online_payments!online_payments_reservation_id_fkey\(/);
  assert.match(reservationService, /payment: payment[\s\S]*providerReference/);
});
