BEGIN;

CREATE TABLE "walk_in_sales" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "receipt_id" UUID NOT NULL,
  "student_id" UUID NOT NULL,
  "cashier_id" UUID,
  "cashier_name_snapshot" TEXT NOT NULL,
  "client_sale_id" VARCHAR(64) NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL,
  "cash_tendered" DECIMAL(12,2) NOT NULL,
  "change_due" DECIMAL(12,2) NOT NULL,
  "voided_by_id" UUID,
  "void_reason" VARCHAR(300),
  "voided_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "walk_in_sales_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "walk_in_sales_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "walk_in_sales_cash_nonnegative_check" CHECK ("cash_tendered" >= 0),
  CONSTRAINT "walk_in_sales_change_nonnegative_check" CHECK ("change_due" >= 0)
);

CREATE UNIQUE INDEX "walk_in_sales_receipt_id_key"
  ON "walk_in_sales"("receipt_id");
CREATE UNIQUE INDEX "walk_in_sales_client_sale_id_key"
  ON "walk_in_sales"("client_sale_id");
CREATE INDEX "walk_in_sales_created_at_id_idx"
  ON "walk_in_sales"("created_at" DESC, "id" DESC);
CREATE INDEX "walk_in_sales_cashier_id_created_at_idx"
  ON "walk_in_sales"("cashier_id", "created_at" DESC);

CREATE TABLE "walk_in_sale_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sale_id" UUID NOT NULL,
  "receipt_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "sku_id" UUID,
  "variant_id" UUID,
  "product_name_snapshot" TEXT NOT NULL,
  "option_snapshot" JSONB,
  "quantity" INTEGER NOT NULL,
  "unit_price" DECIMAL(12,2) NOT NULL,
  "subtotal" DECIMAL(12,2) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "walk_in_sale_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "walk_in_sale_items_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "walk_in_sale_items_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "walk_in_sales"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "walk_in_sale_items_quantity_check" CHECK ("quantity" > 0)
);

CREATE INDEX "walk_in_sale_items_receipt_id_created_at_idx"
  ON "walk_in_sale_items"("receipt_id", "created_at");
CREATE INDEX "walk_in_sale_items_sale_id_created_at_idx"
  ON "walk_in_sale_items"("sale_id", "created_at");
CREATE INDEX "walk_in_sale_items_product_id_created_at_idx"
  ON "walk_in_sale_items"("product_id", "created_at" DESC);

CREATE TABLE "walk_in_sale_cost_allocations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "walk_in_sale_item_id" UUID NOT NULL,
  "inventory_batch_id" UUID NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unit_cost" DECIMAL(12,2) NOT NULL,
  "reversed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "walk_in_sale_cost_allocations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "walk_in_sale_cost_allocations_item_id_fkey" FOREIGN KEY ("walk_in_sale_item_id") REFERENCES "walk_in_sale_items"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "walk_in_sale_cost_allocations_batch_id_fkey" FOREIGN KEY ("inventory_batch_id") REFERENCES "inventory_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "walk_in_sale_cost_allocations_quantity_check" CHECK ("quantity" > 0)
);

CREATE INDEX "walk_in_sale_cost_allocations_item_id_idx"
  ON "walk_in_sale_cost_allocations"("walk_in_sale_item_id");
CREATE INDEX "walk_in_sale_cost_allocations_batch_id_idx"
  ON "walk_in_sale_cost_allocations"("inventory_batch_id");

ALTER TABLE "walk_in_sales" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "walk_in_sale_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "walk_in_sale_cost_allocations" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "walk_in_sales" FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE "walk_in_sale_items" FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE "walk_in_sale_cost_allocations" FROM PUBLIC;

DO $$
DECLARE
  client_role TEXT;
  table_name TEXT;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
      FOREACH table_name IN ARRAY ARRAY['walk_in_sales', 'walk_in_sale_items', 'walk_in_sale_cost_allocations'] LOOP
        EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I', table_name, client_role);
      END LOOP;
    END IF;
  END LOOP;
END
$$;

COMMIT;
