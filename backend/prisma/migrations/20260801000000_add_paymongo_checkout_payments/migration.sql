BEGIN;

-- Existing GCASH rows remain legacy/manual records. PAYMONGO_GCASH is only
-- used when PayMongo has independently confirmed an online GCash payment.
ALTER TYPE "payment_method" ADD VALUE IF NOT EXISTS 'PAYMONGO_GCASH';
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'PAYMENT';

CREATE TYPE "online_payment_status" AS ENUM (
  'INITIALIZING',
  'AWAITING_PAYMENT',
  'PAID',
  'EXPIRED',
  'CANCELLED',
  'REFUND_REVIEW_REQUIRED',
  'PARTIALLY_REFUNDED',
  'REFUNDED'
);

CREATE TYPE "online_payment_attempt_status" AS ENUM (
  'CREATING',
  'CREATE_UNKNOWN',
  'ACTIVE',
  'EXPIRY_REQUESTED',
  'EXPIRED',
  'PAID',
  'FAILED',
  'ABANDONED',
  'MANUAL_REVIEW_REQUIRED'
);

CREATE TYPE "paymongo_webhook_event_status" AS ENUM ('PROCESSED', 'IGNORED', 'REJECTED');

CREATE TABLE "online_payments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "reservation_id" UUID NOT NULL,
  "status" "online_payment_status" NOT NULL DEFAULT 'INITIALIZING',
  "amount_centavos" INTEGER NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'PHP',
  "livemode" BOOLEAN NOT NULL DEFAULT false,
  "provider_checkout_session_id" TEXT,
  "provider_payment_intent_id" TEXT,
  "provider_payment_id" TEXT,
  "checkout_url" TEXT,
  "checkout_expires_at" TIMESTAMPTZ(6),
  "last_reconciled_at" TIMESTAMPTZ(6),
  "fee_centavos" INTEGER,
  "net_amount_centavos" INTEGER,
  "refunded_amount_centavos" INTEGER NOT NULL DEFAULT 0,
  "paid_at" TIMESTAMPTZ(6),
  "expired_at" TIMESTAMPTZ(6),
  "cancelled_at" TIMESTAMPTZ(6),
  "refunded_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "online_payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "online_payments_amount_centavos_check"
    CHECK ("amount_centavos" BETWEEN 100 AND 10000000),
  CONSTRAINT "online_payments_currency_check" CHECK ("currency" = 'PHP'),
  CONSTRAINT "online_payments_fee_centavos_check"
    CHECK ("fee_centavos" IS NULL OR "fee_centavos" BETWEEN 0 AND "amount_centavos"),
  CONSTRAINT "online_payments_net_amount_centavos_check"
    CHECK ("net_amount_centavos" IS NULL OR "net_amount_centavos" BETWEEN 0 AND "amount_centavos"),
  CONSTRAINT "online_payments_refunded_amount_centavos_check"
    CHECK ("refunded_amount_centavos" BETWEEN 0 AND "amount_centavos"),
  CONSTRAINT "online_payments_checkout_url_check"
    CHECK ("checkout_url" IS NULL OR "checkout_url" LIKE 'https://checkout.paymongo.com/%'),
  CONSTRAINT "online_payments_awaiting_checkout_check"
    CHECK (
      "status" <> 'AWAITING_PAYMENT'
      OR ("provider_checkout_session_id" IS NOT NULL AND "checkout_url" IS NOT NULL AND "checkout_expires_at" IS NOT NULL)
    ),
  CONSTRAINT "online_payments_paid_details_check"
    CHECK (
      "status" NOT IN ('PAID', 'REFUND_REVIEW_REQUIRED', 'PARTIALLY_REFUNDED', 'REFUNDED')
      OR (
        "provider_checkout_session_id" IS NOT NULL
        AND "provider_payment_intent_id" IS NOT NULL
        AND "provider_payment_id" IS NOT NULL
        AND "paid_at" IS NOT NULL
      )
    ),
  CONSTRAINT "online_payments_refund_state_check"
    CHECK (
      ("status" <> 'PARTIALLY_REFUNDED' OR "refunded_amount_centavos" BETWEEN 1 AND "amount_centavos" - 1)
      AND (
        "status" <> 'REFUNDED'
        OR ("refunded_amount_centavos" = "amount_centavos" AND "refunded_at" IS NOT NULL)
      )
    )
);

CREATE UNIQUE INDEX "online_payments_reservation_id_key" ON "online_payments"("reservation_id");
CREATE UNIQUE INDEX "online_payments_provider_checkout_session_id_key" ON "online_payments"("provider_checkout_session_id");
CREATE UNIQUE INDEX "online_payments_provider_payment_intent_id_key" ON "online_payments"("provider_payment_intent_id");
CREATE UNIQUE INDEX "online_payments_provider_payment_id_key" ON "online_payments"("provider_payment_id");
CREATE INDEX "online_payments_status_updated_at_idx" ON "online_payments"("status", "updated_at");

ALTER TABLE "online_payments"
  ADD CONSTRAINT "online_payments_reservation_id_fkey"
  FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "online_payment_attempts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "online_payment_id" UUID NOT NULL,
  "attempt_number" INTEGER NOT NULL,
  "status" "online_payment_attempt_status" NOT NULL DEFAULT 'CREATING',
  "provider_idempotency_key" TEXT NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "request_payload" JSONB NOT NULL,
  "provider_checkout_session_id" TEXT,
  "provider_payment_intent_id" TEXT,
  "provider_payment_id" TEXT,
  "checkout_url" TEXT,
  "livemode" BOOLEAN NOT NULL,
  "checkout_expires_at" TIMESTAMPTZ(6),
  "last_reconciled_at" TIMESTAMPTZ(6),
  "expire_requested_at" TIMESTAMPTZ(6),
  "expired_at" TIMESTAMPTZ(6),
  "provider_created_at" TIMESTAMPTZ(6),
  "paid_at" TIMESTAMPTZ(6),
  "fee_centavos" INTEGER,
  "net_amount_centavos" INTEGER,
  "last_provider_error_code" VARCHAR(64),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "online_payment_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "online_payment_attempts_attempt_number_check" CHECK ("attempt_number" > 0),
  CONSTRAINT "online_payment_attempts_idempotency_key_check"
    CHECK (char_length("provider_idempotency_key") BETWEEN 16 AND 255),
  CONSTRAINT "online_payment_attempts_request_hash_check" CHECK ("request_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "online_payment_attempts_checkout_url_check"
    CHECK ("checkout_url" IS NULL OR "checkout_url" LIKE 'https://checkout.paymongo.com/%'),
  CONSTRAINT "online_payment_attempts_fee_centavos_check"
    CHECK ("fee_centavos" IS NULL OR "fee_centavos" >= 0),
  CONSTRAINT "online_payment_attempts_net_amount_centavos_check"
    CHECK ("net_amount_centavos" IS NULL OR "net_amount_centavos" >= 0),
  CONSTRAINT "online_payment_attempts_provider_session_check"
    CHECK (
      ("status" NOT IN ('ACTIVE', 'EXPIRED')
        OR ("provider_checkout_session_id" IS NOT NULL AND "checkout_url" IS NOT NULL))
      AND (
        "status" <> 'PAID'
        OR (
          "provider_checkout_session_id" IS NOT NULL
          AND "provider_payment_intent_id" IS NOT NULL
          AND "provider_payment_id" IS NOT NULL
          AND "paid_at" IS NOT NULL
        )
      )
    )
);

CREATE UNIQUE INDEX "online_payment_attempts_provider_idempotency_key_key"
  ON "online_payment_attempts"("provider_idempotency_key");
CREATE UNIQUE INDEX "online_payment_attempts_provider_checkout_session_id_key"
  ON "online_payment_attempts"("provider_checkout_session_id");
CREATE UNIQUE INDEX "online_payment_attempts_provider_payment_intent_id_key"
  ON "online_payment_attempts"("provider_payment_intent_id");
CREATE UNIQUE INDEX "online_payment_attempts_provider_payment_id_key"
  ON "online_payment_attempts"("provider_payment_id");
CREATE UNIQUE INDEX "online_payment_attempts_online_payment_id_attempt_number_key"
  ON "online_payment_attempts"("online_payment_id", "attempt_number");
CREATE UNIQUE INDEX "online_payment_attempts_one_open_attempt_key"
  ON "online_payment_attempts"("online_payment_id")
  WHERE "status" IN ('CREATING', 'CREATE_UNKNOWN', 'ACTIVE', 'EXPIRY_REQUESTED');
CREATE INDEX "online_payment_attempts_online_payment_id_status_created_at_idx"
  ON "online_payment_attempts"("online_payment_id", "status", "created_at");
CREATE INDEX "online_payment_attempts_status_checkout_expires_at_idx"
  ON "online_payment_attempts"("status", "checkout_expires_at");

ALTER TABLE "online_payment_attempts"
  ADD CONSTRAINT "online_payment_attempts_online_payment_id_fkey"
  FOREIGN KEY ("online_payment_id") REFERENCES "online_payments"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- The exact request and provider identity form an append-only financial attempt
-- record. Lifecycle timestamps/status may change; request identity may not.
CREATE FUNCTION protect_online_payment_attempt_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.online_payment_id IS DISTINCT FROM NEW.online_payment_id
    OR OLD.attempt_number IS DISTINCT FROM NEW.attempt_number
    OR OLD.provider_idempotency_key IS DISTINCT FROM NEW.provider_idempotency_key
    OR OLD.request_hash IS DISTINCT FROM NEW.request_hash
    OR OLD.request_payload IS DISTINCT FROM NEW.request_payload
    OR OLD.livemode IS DISTINCT FROM NEW.livemode
    OR (OLD.provider_checkout_session_id IS NOT NULL AND OLD.provider_checkout_session_id IS DISTINCT FROM NEW.provider_checkout_session_id)
    OR (OLD.provider_payment_intent_id IS NOT NULL AND OLD.provider_payment_intent_id IS DISTINCT FROM NEW.provider_payment_intent_id)
    OR (OLD.provider_payment_id IS NOT NULL AND OLD.provider_payment_id IS DISTINCT FROM NEW.provider_payment_id)
    OR (OLD.checkout_url IS NOT NULL AND OLD.checkout_url IS DISTINCT FROM NEW.checkout_url)
  THEN
    RAISE EXCEPTION 'online payment attempt identity and request are immutable';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER "online_payment_attempts_protect_identity"
BEFORE UPDATE ON "online_payment_attempts"
FOR EACH ROW EXECUTE FUNCTION protect_online_payment_attempt_identity();

CREATE TABLE "paymongo_webhook_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "provider_event_id" TEXT,
  "dedupe_key" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "livemode" BOOLEAN NOT NULL,
  "resource_id" TEXT,
  "payload_hash" CHAR(64) NOT NULL,
  "status" "paymongo_webhook_event_status" NOT NULL,
  "reason_code" VARCHAR(64),
  "online_payment_id" UUID,
  "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "paymongo_webhook_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "paymongo_webhook_events_payload_hash_check" CHECK ("payload_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "paymongo_webhook_events_dedupe_key_check" CHECK (char_length("dedupe_key") BETWEEN 16 AND 255),
  CONSTRAINT "paymongo_webhook_events_reason_code_check"
    CHECK (
      ("status" = 'REJECTED' AND "reason_code" ~ '^[A-Z0-9_]{3,64}$')
      OR ("status" <> 'REJECTED' AND "reason_code" IS NULL)
    )
);

CREATE UNIQUE INDEX "paymongo_webhook_events_provider_event_id_key" ON "paymongo_webhook_events"("provider_event_id");
CREATE UNIQUE INDEX "paymongo_webhook_events_dedupe_key_key" ON "paymongo_webhook_events"("dedupe_key");
CREATE INDEX "paymongo_webhook_events_event_type_received_at_idx" ON "paymongo_webhook_events"("event_type", "received_at");
CREATE INDEX "paymongo_webhook_events_online_payment_id_received_at_idx" ON "paymongo_webhook_events"("online_payment_id", "received_at");

ALTER TABLE "paymongo_webhook_events"
  ADD CONSTRAINT "paymongo_webhook_events_online_payment_id_fkey"
  FOREIGN KEY ("online_payment_id") REFERENCES "online_payments"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Some existing Supabase projects created this table from the legacy SQL file.
-- Creating it here when absent makes payment audit writes transactionally reliable.
CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "actor_id" UUID REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "action" TEXT NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" TEXT,
  "summary" TEXT NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "audit_logs_created_at_idx" ON "audit_logs"("created_at" DESC);
CREATE INDEX IF NOT EXISTS "audit_logs_actor_id_idx" ON "audit_logs"("actor_id");
CREATE INDEX IF NOT EXISTS "audit_logs_action_idx" ON "audit_logs"("action");
CREATE INDEX IF NOT EXISTS "audit_logs_entity_idx" ON "audit_logs"("entity_type", "entity_id");

-- Browser roles cannot read or mutate payment/audit records directly. All
-- access remains behind the authenticated backend and its server-only role.
ALTER TABLE public.online_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.online_payment_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paymongo_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.online_payments FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.online_payment_attempts FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.paymongo_webhook_events FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.audit_logs FROM PUBLIC;

DO $block$
DECLARE
  client_role text;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.online_payments FROM %I', client_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.online_payment_attempts FROM %I', client_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.paymongo_webhook_events FROM %I', client_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.audit_logs FROM %I', client_role);
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL PRIVILEGES ON TABLE public.online_payments TO service_role;
    GRANT ALL PRIVILEGES ON TABLE public.online_payment_attempts TO service_role;
    GRANT ALL PRIVILEGES ON TABLE public.paymongo_webhook_events TO service_role;
    GRANT ALL PRIVILEGES ON TABLE public.audit_logs TO service_role;
  END IF;
END
$block$;

COMMIT;
