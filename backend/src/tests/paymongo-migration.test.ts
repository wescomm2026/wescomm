import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.resolve(
  process.cwd(),
  "prisma/migrations/20260801000000_add_paymongo_checkout_payments/migration.sql"
);
const schemaPath = path.resolve(process.cwd(), "prisma/schema.prisma");

test("PayMongo migration creates one provider payment per reservation with durable deduplication", () => {
  const sql = readFileSync(migrationPath, "utf8");

  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);
  assert.match(sql, /ADD VALUE IF NOT EXISTS 'PAYMONGO_GCASH'/);
  assert.match(sql, /CREATE TYPE "online_payment_status" AS ENUM[\s\S]*'INITIALIZING'[\s\S]*'AWAITING_PAYMENT'[\s\S]*'PAID'[\s\S]*'EXPIRED'[\s\S]*'CANCELLED'[\s\S]*'REFUND_REVIEW_REQUIRED'[\s\S]*'PARTIALLY_REFUNDED'[\s\S]*'REFUNDED'/);
  assert.match(sql, /CREATE TYPE "online_payment_attempt_status" AS ENUM[\s\S]*'CREATE_UNKNOWN'[\s\S]*'EXPIRY_REQUESTED'[\s\S]*'MANUAL_REVIEW_REQUIRED'/);
  assert.match(sql, /CREATE TABLE "online_payments"/);
  assert.match(sql, /CREATE TABLE "online_payment_attempts"/);
  assert.match(sql, /CREATE UNIQUE INDEX "online_payments_reservation_id_key"/);
  assert.match(sql, /CREATE UNIQUE INDEX "online_payments_provider_checkout_session_id_key"/);
  assert.match(sql, /CREATE UNIQUE INDEX "online_payments_provider_payment_id_key"/);
  assert.match(sql, /CREATE UNIQUE INDEX "online_payment_attempts_provider_idempotency_key_key"/);
  assert.match(sql, /CREATE UNIQUE INDEX "online_payment_attempts_provider_checkout_session_id_key"/);
  assert.match(sql, /CREATE UNIQUE INDEX "online_payment_attempts_one_open_attempt_key"[\s\S]*WHERE "status" IN \('CREATING', 'CREATE_UNKNOWN', 'ACTIVE', 'EXPIRY_REQUESTED'\)/);
  assert.match(sql, /CREATE UNIQUE INDEX "paymongo_webhook_events_dedupe_key_key"/);
  assert.match(sql, /FOREIGN KEY \("reservation_id"\) REFERENCES "reservations"\("id"\)[\s\S]*ON DELETE RESTRICT/);
  assert.match(sql, /CREATE TRIGGER "online_payment_attempts_protect_identity"/);
});

test("database constraints keep GCash values in PHP centavos and financial states internally consistent", () => {
  const sql = readFileSync(migrationPath, "utf8");

  assert.match(sql, /CHECK \("amount_centavos" BETWEEN 100 AND 10000000\)/);
  assert.match(sql, /CHECK \("currency" = 'PHP'\)/);
  assert.match(sql, /CHECK \("refunded_amount_centavos" BETWEEN 0 AND "amount_centavos"\)/);
  assert.match(sql, /"status" <> 'AWAITING_PAYMENT'[\s\S]*"provider_checkout_session_id" IS NOT NULL[\s\S]*"checkout_url" IS NOT NULL/);
  assert.match(sql, /"status" NOT IN \('PAID', 'REFUND_REVIEW_REQUIRED', 'PARTIALLY_REFUNDED', 'REFUNDED'\)[\s\S]*"provider_payment_intent_id" IS NOT NULL[\s\S]*"provider_payment_id" IS NOT NULL[\s\S]*"paid_at" IS NOT NULL/);
  assert.match(sql, /"status" <> 'PAID'[\s\S]*"provider_checkout_session_id" IS NOT NULL[\s\S]*"provider_payment_intent_id" IS NOT NULL[\s\S]*"provider_payment_id" IS NOT NULL[\s\S]*"paid_at" IS NOT NULL/);
  assert.match(sql, /"status" <> 'PARTIALLY_REFUNDED'[\s\S]*"refunded_amount_centavos" BETWEEN 1 AND "amount_centavos" - 1/);
  assert.match(sql, /"status" <> 'REFUNDED'[\s\S]*"refunded_amount_centavos" = "amount_centavos"[\s\S]*"refunded_at" IS NOT NULL/);
  assert.match(sql, /CHECK \("checkout_url" IS NULL OR "checkout_url" LIKE 'https:\/\/checkout\.paymongo\.com\/%'\)/);
});

test("financial and webhook tables stay behind the server-only database role", () => {
  const sql = readFileSync(migrationPath, "utf8");

  for (const table of ["online_payments", "online_payment_attempts", "paymongo_webhook_events", "audit_logs"]) {
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
    assert.match(sql, new RegExp(`REVOKE ALL PRIVILEGES ON TABLE public\\.${table} FROM PUBLIC`));
    assert.match(sql, new RegExp(`GRANT ALL PRIVILEGES ON TABLE public\\.${table} TO service_role`));
  }

  assert.match(sql, /ARRAY\['anon', 'authenticated'\]/);
  assert.doesNotMatch(sql, /CREATE POLICY/i);
  assert.doesNotMatch(sql, /FORCE ROW LEVEL SECURITY/i);
});

test("webhook persistence is limited to hashes and provider references, not raw payloads", () => {
  const sql = readFileSync(migrationPath, "utf8");
  const webhookTable = sql.match(/CREATE TABLE "paymongo_webhook_events" \(([\s\S]*?)\n\);/)?.[1];

  assert.ok(webhookTable, "paymongo_webhook_events definition must exist");
  assert.match(webhookTable, /"payload_hash" CHAR\(64\) NOT NULL/);
  assert.match(webhookTable, /"reason_code" VARCHAR\(64\)/);
  assert.match(sql, /CHECK \("payload_hash" ~ '\^\[0-9a-f\]\{64\}\$'\)/);
  assert.match(sql, /"status" = 'REJECTED'[\s\S]*"reason_code" ~ '\^\[A-Z0-9_\]\{3,64\}\$'/);
  assert.doesNotMatch(webhookTable, /"(?:payload|body|email|name|phone|metadata)"/i);
  assert.doesNotMatch(webhookTable, /\bJSONB?\b/i);
});

test("Prisma exposes the payment relation as a singular reservation-owned record", () => {
  const schema = readFileSync(schemaPath, "utf8");

  assert.match(schema, /enum PaymentMethod \{[\s\S]*PAYMONGO_GCASH[\s\S]*\}/);
  assert.match(schema, /model Reservation \{[\s\S]*onlinePayment\s+OnlinePayment\?[\s\S]*\}/);
  assert.match(schema, /model OnlinePayment \{[\s\S]*reservationId\s+String\s+@unique[\s\S]*@@map\("online_payments"\)[\s\S]*\}/);
  assert.match(schema, /model OnlinePaymentAttempt \{[\s\S]*requestPayload\s+Json[\s\S]*providerCheckoutSessionId\s+String\?[\s\S]*@@map\("online_payment_attempts"\)[\s\S]*\}/);
  assert.match(schema, /model PaymongoWebhookEvent \{[\s\S]*payloadHash\s+String[^\n]*@db\.Char\(64\)[\s\S]*@@map\("paymongo_webhook_events"\)[\s\S]*\}/);
});
