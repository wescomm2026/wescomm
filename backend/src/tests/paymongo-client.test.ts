import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPaymongoCheckoutRequest,
  isTrustedPaymongoCheckoutUrl,
  mapInvalidPaymongoResponse,
  mapPaymongoProviderError,
  parseCreatedPaymongoCheckoutSession,
  parseExpiredPaymongoCheckoutSession,
  parseRetrievedPaymongoCheckoutSession
} from "../services/paymongo-client.js";
import { HttpError } from "../utils/http-error.js";

test("Hosted Checkout v2 request is GCash-only and carries only WESCOMM record identifiers", () => {
  const request = buildPaymongoCheckoutRequest({
    idempotencyKey: "wescomm-checkout-test-key",
    referenceNumber: "WES-2026-ABC123",
    successUrl: "https://wescomm.example/student/payments/payment-id?result=success",
    cancelUrl: "https://wescomm.example/student/payments/payment-id?result=cancelled",
    metadata: {
      reservation_id: "11111111-1111-4111-8111-111111111111",
      online_payment_id: "22222222-2222-4222-8222-222222222222",
      online_payment_attempt_id: "33333333-3333-4333-8333-333333333333"
    },
    lineItems: [{ name: "  PE\nUniform  ", amountCentavos: 12_345, quantity: 2 }]
  });

  const attributes = request.data.attributes;
  assert.deepEqual(attributes.payment_method_types, ["gcash"]);
  assert.equal(attributes.send_email_receipt, false);
  assert.deepEqual(attributes.line_items, [{
    name: "PE Uniform",
    amount: 12_345,
    currency: "PHP",
    quantity: 2
  }]);
  assert.deepEqual(attributes.metadata, {
    reservation_id: "11111111-1111-4111-8111-111111111111",
    online_payment_id: "22222222-2222-4222-8222-222222222222",
    online_payment_attempt_id: "33333333-3333-4333-8333-333333333333"
  });
  assert.equal("billing" in attributes, false);
  assert.deepEqual(Object.keys(attributes.metadata).sort(), [
    "online_payment_attempt_id",
    "online_payment_id",
    "reservation_id"
  ]);
});

test("only the exact HTTPS PayMongo checkout host is accepted", () => {
  assert.equal(isTrustedPaymongoCheckoutUrl("https://checkout.paymongo.com/cs_test"), true);
  assert.equal(isTrustedPaymongoCheckoutUrl("http://checkout.paymongo.com/cs_test"), false);
  assert.equal(isTrustedPaymongoCheckoutUrl("https://checkout.paymongo.com.attacker.example/cs_test"), false);
  assert.equal(isTrustedPaymongoCheckoutUrl("https://checkout.paymongo.com@attacker.example/cs_test"), false);
  assert.equal(isTrustedPaymongoCheckoutUrl("https://user:pass@checkout.paymongo.com/cs_test"), false);
});

test("an invalid 2xx create response is an unknown outcome, never a definitive failure", () => {
  const invalidJsonOutcome = mapInvalidPaymongoResponse("create");
  assert.equal(invalidJsonOutcome.status, 503);
  assert.equal(invalidJsonOutcome.code, "PAYMONGO_CREATE_OUTCOME_UNKNOWN");
  assert.equal(invalidJsonOutcome.details?.retryable, true);
  assert.equal(invalidJsonOutcome.details?.outcomeUnknown, true);

  for (const payload of [
    {},
    {
      data: {
        id: "cs_test_untrusted",
        type: "checkout_session",
        attributes: {
          checkout_url: "https://checkout.paymongo.com.attacker.example/cs_test_untrusted",
          livemode: false
        }
      }
    }
  ]) {
    assert.throws(
      () => parseCreatedPaymongoCheckoutSession(payload),
      (error: unknown) => error instanceof HttpError
        && error.code === "PAYMONGO_CREATE_OUTCOME_UNKNOWN"
        && error.details?.retryable === true
    );
  }

  assert.throws(
    () => parseCreatedPaymongoCheckoutSession({
      data: {
        id: "cs_test_salvageable",
        type: "checkout_session",
        attributes: { checkout_url: "https://attacker.example/checkout", livemode: false }
      }
    }),
    (error: unknown) => error instanceof HttpError
      && error.code === "PAYMONGO_CREATE_OUTCOME_UNKNOWN"
      && error.details?.providerCheckoutSessionId === "cs_test_salvageable"
      && error.details?.retryable === true
  );

  const invalidGet = mapInvalidPaymongoResponse("get");
  assert.equal(invalidGet.code, "INVALID_PAYMONGO_RESPONSE");
  assert.equal(invalidGet.details?.retryable, false);
});

test("Checkout Session retrieval validates the authoritative provider shape", () => {
  const payload = {
    data: {
      id: "cs_test_reconcile",
      type: "checkout_session",
      attributes: {
        checkout_url: "https://checkout.paymongo.com/cs_test_reconcile",
        livemode: false,
        status: "active",
        reference_number: "WES-2026-ABC123",
        metadata: {
          reservation_id: "11111111-1111-4111-8111-111111111111",
          online_payment_id: "22222222-2222-4222-8222-222222222222",
          online_payment_attempt_id: "33333333-3333-4333-8333-333333333333"
        },
        payment_intent: null,
        payments: [],
        created_at: 1_754_023_200
      }
    }
  };
  const parsed = parseRetrievedPaymongoCheckoutSession(payload);
  assert.equal(parsed.id, "cs_test_reconcile");
  assert.equal(parsed.status, "active");
  assert.deepEqual(parsed.payments, []);

  assert.throws(
    () => parseRetrievedPaymongoCheckoutSession({
      ...payload,
      data: { ...payload.data, attributes: { ...payload.data.attributes, livemode: "false" } }
    }),
    (error: unknown) => error instanceof HttpError && error.code === "INVALID_PAYMONGO_RESPONSE"
  );
});

test("Checkout Session expiration validates identity and terminal status", () => {
  assert.deepEqual(parseExpiredPaymongoCheckoutSession({
    data: {
      id: "cs_test_expired",
      type: "checkout_session",
      attributes: { status: "expired" }
    }
  }, "cs_test_expired"), { id: "cs_test_expired", status: "expired" });
  assert.throws(
    () => parseExpiredPaymongoCheckoutSession({
      data: {
        id: "cs_different",
        type: "checkout_session",
        attributes: { status: "expired" }
      }
    }, "cs_test_expired"),
    (error: unknown) => error instanceof HttpError && error.code === "INVALID_PAYMONGO_RESPONSE"
  );
});

test("PayMongo GET and expire status codes map to stable retry semantics", () => {
  const missing = mapPaymongoProviderError(404, "get");
  assert.equal(missing.code, "PAYMONGO_CHECKOUT_NOT_FOUND");
  assert.equal(missing.details?.retryable, false);

  const notExpirable = mapPaymongoProviderError(400, "expire");
  assert.equal(notExpirable.code, "PAYMONGO_CHECKOUT_NOT_EXPIRABLE");
  assert.equal(notExpirable.details?.retryable, false);

  const throttled = mapPaymongoProviderError(429, "get");
  assert.equal(throttled.status, 503);
  assert.equal(throttled.details?.retryable, true);
});
