BEGIN;

-- V7 SKU inventory is additive and deliberately does not reinterpret legacy variant stock.
-- Existing products remain on legacy inventory until staff completes reconciliation.

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "sku_inventory_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "inventory_reconciled_at" TIMESTAMPTZ(6);

CREATE TABLE IF NOT EXISTS "product_skus" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "product_id" UUID NOT NULL,
  "code" TEXT,
  "stock" INTEGER NOT NULL DEFAULT 0,
  "low_stock_threshold" INTEGER NOT NULL DEFAULT 2,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "option_snapshot" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_skus_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_skus_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "product_skus_product_id_code_key" UNIQUE ("product_id", "code"),
  CONSTRAINT "product_skus_stock_nonnegative" CHECK ("stock" >= 0),
  CONSTRAINT "product_skus_low_stock_threshold_nonnegative" CHECK ("low_stock_threshold" >= 0)
);

CREATE INDEX IF NOT EXISTS "product_skus_product_id_is_active_idx"
  ON "product_skus"("product_id", "is_active");

CREATE TABLE IF NOT EXISTS "product_sku_variants" (
  "sku_id" UUID NOT NULL,
  "variant_id" UUID NOT NULL,
  CONSTRAINT "product_sku_variants_pkey" PRIMARY KEY ("sku_id", "variant_id"),
  CONSTRAINT "product_sku_variants_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "product_skus"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "product_sku_variants_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "product_sku_variants_variant_id_idx"
  ON "product_sku_variants"("variant_id");

ALTER TABLE "reservation_items"
  ADD COLUMN IF NOT EXISTS "sku_id" UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reservation_items_sku_id_fkey' AND conrelid = 'public.reservation_items'::regclass
  ) THEN
    ALTER TABLE "reservation_items"
      ADD CONSTRAINT "reservation_items_sku_id_fkey"
      FOREIGN KEY ("sku_id") REFERENCES "product_skus"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "reservation_items_sku_id_idx"
  ON "reservation_items"("sku_id");

ALTER TABLE "inventory_movements"
  ADD COLUMN IF NOT EXISTS "sku_id" UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inventory_movements_sku_id_fkey' AND conrelid = 'public.inventory_movements'::regclass
  ) THEN
    ALTER TABLE "inventory_movements"
      ADD CONSTRAINT "inventory_movements_sku_id_fkey"
      FOREIGN KEY ("sku_id") REFERENCES "product_skus"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "inventory_movements_sku_id_created_at_idx"
  ON "inventory_movements"("sku_id", "created_at" DESC);


-- Defense in depth for Supabase's exposed public schema. Application writes use the backend only.
ALTER TABLE "product_skus" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_sku_variants" ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE "product_skus" FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE "product_sku_variants" FROM PUBLIC;

DO $security$
DECLARE
  client_role text;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.product_skus FROM %I', client_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.product_sku_variants FROM %I', client_role);
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL PRIVILEGES ON TABLE "product_skus" TO service_role;
    GRANT ALL PRIVILEGES ON TABLE "product_sku_variants" TO service_role;
  END IF;
END
$security$;

COMMIT;
