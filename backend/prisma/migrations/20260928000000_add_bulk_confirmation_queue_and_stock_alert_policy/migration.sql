BEGIN;

ALTER TABLE "products"
  ADD COLUMN "stock_target" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "low_stock_percent" INTEGER NOT NULL DEFAULT 25;

ALTER TABLE "product_variants"
  ADD COLUMN "stock_target" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "low_stock_percent" INTEGER NOT NULL DEFAULT 25;

ALTER TABLE "product_skus"
  ADD COLUMN "stock_target" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "low_stock_percent" INTEGER NOT NULL DEFAULT 25;

UPDATE "products"
SET "stock_target" = LEAST(10000000, GREATEST("stock", "low_stock_threshold" * 4));

UPDATE "product_variants"
SET "stock_target" = LEAST(10000000, GREATEST("stock", "low_stock_threshold" * 4));

UPDATE "product_skus"
SET "stock_target" = LEAST(10000000, GREATEST("stock", "low_stock_threshold" * 4));

ALTER TABLE "products"
  ADD CONSTRAINT "products_stock_target_nonnegative" CHECK ("stock_target" BETWEEN 0 AND 10000000),
  ADD CONSTRAINT "products_low_stock_percent_range" CHECK ("low_stock_percent" BETWEEN 1 AND 100);

ALTER TABLE "product_variants"
  ADD CONSTRAINT "product_variants_stock_target_nonnegative" CHECK ("stock_target" BETWEEN 0 AND 10000000),
  ADD CONSTRAINT "product_variants_low_stock_percent_range" CHECK ("low_stock_percent" BETWEEN 1 AND 100);

ALTER TABLE "product_skus"
  ADD CONSTRAINT "product_skus_stock_target_nonnegative" CHECK ("stock_target" BETWEEN 0 AND 10000000),
  ADD CONSTRAINT "product_skus_low_stock_percent_range" CHECK ("low_stock_percent" BETWEEN 1 AND 100);

CREATE TABLE "reservation_bulk_actions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "actor_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "request_hash" VARCHAR(64) NOT NULL,
  "result" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reservation_bulk_actions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "reservation_bulk_actions_actor_id_idempotency_key_key"
  ON "reservation_bulk_actions"("actor_id", "idempotency_key");
CREATE INDEX "reservation_bulk_actions_created_at_idx"
  ON "reservation_bulk_actions"("created_at");
CREATE INDEX "reservations_confirmation_queue_idx"
  ON "reservations"("status", "pickup_time_slot_id", "pickup_start", "created_at", "id");

ALTER TABLE "reservation_bulk_actions" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "reservation_bulk_actions" FROM PUBLIC;

DO $$
DECLARE
  client_role TEXT;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.reservation_bulk_actions FROM %I', client_role);
    END IF;
  END LOOP;
END
$$;

COMMIT;
