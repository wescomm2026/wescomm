BEGIN;

ALTER TYPE "payment_method" ADD VALUE IF NOT EXISTS 'OTHER';

DO $$ BEGIN
  CREATE TYPE "collection_channel" AS ENUM ('COMMISSARY', 'TREASURER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "payment_record_status" AS ENUM ('PAID', 'VOIDED', 'REFUNDED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "reservations"
  ADD COLUMN IF NOT EXISTS "completed_at" TIMESTAMPTZ(6);

UPDATE "reservations"
SET "completed_at" = COALESCE("updated_at", "created_at")
WHERE "status" = 'COMPLETED'::"reservation_status"
  AND "completed_at" IS NULL;

ALTER TABLE "reservation_items"
  ADD COLUMN IF NOT EXISTS "category_id_snapshot" UUID,
  ADD COLUMN IF NOT EXISTS "category_name_snapshot" TEXT;

UPDATE "reservation_items" AS item
SET "category_id_snapshot" = category."id",
    "category_name_snapshot" = category."name"
FROM "products" AS product
INNER JOIN "categories" AS category ON category."id" = product."category_id"
WHERE product."id" = item."product_id"
  AND (item."category_id_snapshot" IS NULL OR item."category_name_snapshot" IS NULL);

CREATE TABLE IF NOT EXISTS "inventory_batches" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "batch_code" TEXT NOT NULL,
  "product_id" UUID NOT NULL,
  "sku_id" UUID,
  "quantity_received" INTEGER NOT NULL,
  "quantity_remaining" INTEGER NOT NULL,
  "unit_cost" DECIMAL(12,2) NOT NULL,
  "cost_verified" BOOLEAN NOT NULL DEFAULT true,
  "received_at" TIMESTAMPTZ(6) NOT NULL,
  "supplier_note" TEXT,
  "created_by_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_batches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_batches_batch_code_key" UNIQUE ("batch_code"),
  CONSTRAINT "inventory_batches_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_batches_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "product_skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_batches_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "inventory_batches_quantity_received_positive" CHECK ("quantity_received" > 0),
  CONSTRAINT "inventory_batches_quantity_remaining_valid" CHECK ("quantity_remaining" >= 0 AND "quantity_remaining" <= "quantity_received"),
  CONSTRAINT "inventory_batches_unit_cost_nonnegative" CHECK ("unit_cost" >= 0)
);

CREATE INDEX IF NOT EXISTS "inventory_batches_product_id_received_at_id_idx"
  ON "inventory_batches"("product_id", "received_at", "id");
CREATE INDEX IF NOT EXISTS "inventory_batches_sku_id_received_at_id_idx"
  ON "inventory_batches"("sku_id", "received_at", "id");
CREATE INDEX IF NOT EXISTS "inventory_batches_product_id_quantity_remaining_idx"
  ON "inventory_batches"("product_id", "quantity_remaining");

-- Existing stock becomes an explicit opening balance. Its cost must be reviewed by staff;
-- reports surface these unverified quantities instead of silently claiming exact profit.
INSERT INTO "inventory_batches" (
  "batch_code", "product_id", "sku_id", "quantity_received", "quantity_remaining",
  "unit_cost", "cost_verified", "received_at", "supplier_note"
)
SELECT
  'OPEN-SKU-' || REPLACE(sku."id"::text, '-', ''),
  sku."product_id",
  sku."id",
  sku."stock",
  sku."stock",
  0,
  false,
  CURRENT_TIMESTAMP,
  'Opening inventory migrated from the pre-FIFO stock balance.'
FROM "product_skus" AS sku
INNER JOIN "products" AS product ON product."id" = sku."product_id"
WHERE product."sku_inventory_enabled" = true
  AND sku."is_active" = true
  AND sku."stock" > 0
ON CONFLICT ("batch_code") DO NOTHING;

INSERT INTO "inventory_batches" (
  "batch_code", "product_id", "sku_id", "quantity_received", "quantity_remaining",
  "unit_cost", "cost_verified", "received_at", "supplier_note"
)
SELECT
  'OPEN-PROD-' || REPLACE(product."id"::text, '-', ''),
  product."id",
  NULL,
  product."stock",
  product."stock",
  0,
  false,
  CURRENT_TIMESTAMP,
  'Opening inventory migrated from the pre-FIFO stock balance.'
FROM "products" AS product
WHERE product."sku_inventory_enabled" = false
  AND product."stock" > 0
ON CONFLICT ("batch_code") DO NOTHING;

CREATE TABLE IF NOT EXISTS "order_item_cost_allocations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "reservation_item_id" UUID NOT NULL,
  "inventory_batch_id" UUID NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unit_cost" DECIMAL(12,2) NOT NULL,
  "allocated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reversed_at" TIMESTAMPTZ(6),
  "reversal_reason" TEXT,
  CONSTRAINT "order_item_cost_allocations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "order_item_cost_allocations_reservation_item_id_inventory_batch_id_key" UNIQUE ("reservation_item_id", "inventory_batch_id"),
  CONSTRAINT "order_item_cost_allocations_reservation_item_id_fkey" FOREIGN KEY ("reservation_item_id") REFERENCES "reservation_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "order_item_cost_allocations_inventory_batch_id_fkey" FOREIGN KEY ("inventory_batch_id") REFERENCES "inventory_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "order_item_cost_allocations_quantity_positive" CHECK ("quantity" > 0),
  CONSTRAINT "order_item_cost_allocations_unit_cost_nonnegative" CHECK ("unit_cost" >= 0)
);

CREATE INDEX IF NOT EXISTS "order_item_cost_allocations_inventory_batch_id_idx"
  ON "order_item_cost_allocations"("inventory_batch_id");
CREATE INDEX IF NOT EXISTS "order_item_cost_allocations_allocated_at_idx"
  ON "order_item_cost_allocations"("allocated_at");

CREATE TABLE IF NOT EXISTS "payments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "reservation_id" UUID NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "status" "payment_record_status" NOT NULL DEFAULT 'PAID',
  "payment_method" "payment_method" NOT NULL,
  "collection_channel" "collection_channel" NOT NULL,
  "official_receipt_number" TEXT,
  "paid_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "verified_by_id" UUID,
  "voided_at" TIMESTAMPTZ(6),
  "voided_by_id" UUID,
  "void_reason" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payments_reservation_id_key" UNIQUE ("reservation_id"),
  CONSTRAINT "payments_official_receipt_number_key" UNIQUE ("official_receipt_number"),
  CONSTRAINT "payments_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payments_verified_by_id_fkey" FOREIGN KEY ("verified_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "payments_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "payments_amount_positive" CHECK ("amount" > 0),
  CONSTRAINT "payments_treasurer_or_required" CHECK (
    "collection_channel" <> 'TREASURER'::"collection_channel"
    OR NULLIF(BTRIM("official_receipt_number"), '') IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "payments_active_treasurer_or_key"
  ON "payments" (LOWER("official_receipt_number"))
  WHERE "collection_channel" = 'TREASURER'::"collection_channel"
    AND "status" = 'PAID'::"payment_record_status";
CREATE INDEX IF NOT EXISTS "payments_collection_channel_status_paid_at_idx"
  ON "payments"("collection_channel", "status", "paid_at" DESC);
CREATE INDEX IF NOT EXISTS "payments_payment_method_status_paid_at_idx"
  ON "payments"("payment_method", "status", "paid_at" DESC);

INSERT INTO "payments" (
  "reservation_id", "amount", "status", "payment_method", "collection_channel",
  "paid_at", "verified_by_id", "voided_at", "voided_by_id", "void_reason"
)
SELECT
  receipt."reservation_id",
  receipt."total_amount",
  CASE WHEN receipt."status" = 'VOIDED'::"receipt_status"
    THEN 'VOIDED'::"payment_record_status"
    ELSE 'PAID'::"payment_record_status"
  END,
  receipt."payment_method",
  'COMMISSARY'::"collection_channel",
  COALESCE(receipt."verified_at", receipt."issued_at"),
  receipt."issued_by_id",
  receipt."voided_at",
  CASE WHEN receipt."status" = 'VOIDED'::"receipt_status" THEN receipt."issued_by_id" ELSE NULL END,
  CASE WHEN receipt."status" = 'VOIDED'::"receipt_status" THEN 'Migrated voided receipt.' ELSE NULL END
FROM "receipts" AS receipt
WHERE receipt."reservation_id" IS NOT NULL
  AND receipt."status" IN ('VERIFIED'::"receipt_status", 'VOIDED'::"receipt_status")
ON CONFLICT ("reservation_id") DO NOTHING;

ALTER TABLE "inventory_batches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_item_cost_allocations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE "inventory_batches" FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE "order_item_cost_allocations" FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE "payments" FROM PUBLIC;

DO $security$
DECLARE client_role text;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.inventory_batches FROM %I', client_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.order_item_cost_allocations FROM %I', client_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.payments FROM %I', client_role);
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL PRIVILEGES ON TABLE "inventory_batches" TO service_role;
    GRANT ALL PRIVILEGES ON TABLE "order_item_cost_allocations" TO service_role;
    GRANT ALL PRIVILEGES ON TABLE "payments" TO service_role;
  END IF;
END $security$;

COMMIT;
