BEGIN;

-- Walk-in sales may now be paid at the school Treasury. Commissary sales keep
-- the cash/change columns; Treasury sales carry the inspected official receipt
-- number instead and never record cash handled by the Commissary cashier.
ALTER TABLE "walk_in_sales"
  ADD COLUMN "collection_channel" "collection_channel" NOT NULL DEFAULT 'COMMISSARY'::"collection_channel",
  ADD COLUMN "official_receipt_number" VARCHAR(100),
  ADD COLUMN "treasury_verified_by_id" UUID,
  ADD COLUMN "treasury_verified_at" TIMESTAMPTZ(6),
  ALTER COLUMN "cash_tendered" DROP NOT NULL,
  ALTER COLUMN "change_due" DROP NOT NULL;

ALTER TABLE "walk_in_sales"
  ADD CONSTRAINT "walk_in_sales_collection_details_check" CHECK (
    (
      "collection_channel" = 'COMMISSARY'::"collection_channel"
      AND "official_receipt_number" IS NULL
      AND "treasury_verified_by_id" IS NULL
      AND "treasury_verified_at" IS NULL
      AND "cash_tendered" IS NOT NULL
      AND "change_due" IS NOT NULL
    )
    OR (
      "collection_channel" = 'TREASURER'::"collection_channel"
      AND NULLIF(BTRIM("official_receipt_number"), '') IS NOT NULL
      AND "treasury_verified_at" IS NOT NULL
      AND "cash_tendered" IS NULL
      AND "change_due" IS NULL
    )
  );

CREATE INDEX "walk_in_sales_collection_channel_created_at_idx"
  ON "walk_in_sales"("collection_channel", "created_at" DESC);

-- One normalization rule for every Treasury OR comparison: case-insensitive,
-- ignoring spaces and hyphens ("or-0012 345" = "OR0012345").
CREATE OR REPLACE FUNCTION public.normalize_treasury_or_number(value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(UPPER(REGEXP_REPLACE(COALESCE(value, ''), '[[:space:]-]+', '', 'g')), '')
$$;

-- Shared registry so a Treasury OR can back exactly one transaction across
-- reservation payments and walk-in sales. Rows are never released on void:
-- a voided Treasury collection still needs Treasury-side reconciliation.
CREATE TABLE "treasury_official_receipts" (
  "normalized_official_receipt_number" TEXT NOT NULL,
  "official_receipt_number" TEXT NOT NULL,
  "source_type" TEXT NOT NULL,
  "payment_id" UUID,
  "walk_in_sale_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "treasury_official_receipts_official_receipt_number_pkey" PRIMARY KEY ("normalized_official_receipt_number"),
  CONSTRAINT "treasury_official_receipts_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "treasury_official_receipts_walk_in_sale_id_fkey" FOREIGN KEY ("walk_in_sale_id") REFERENCES "walk_in_sales"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "treasury_official_receipts_source_check" CHECK (
    ("source_type" = 'RESERVATION_PAYMENT' AND "payment_id" IS NOT NULL AND "walk_in_sale_id" IS NULL)
    OR ("source_type" = 'WALK_IN_SALE' AND "walk_in_sale_id" IS NOT NULL AND "payment_id" IS NULL)
  )
);

CREATE INDEX "treasury_official_receipts_payment_id_idx"
  ON "treasury_official_receipts"("payment_id");
CREATE INDEX "treasury_official_receipts_walk_in_sale_id_idx"
  ON "treasury_official_receipts"("walk_in_sale_id");

INSERT INTO "treasury_official_receipts" (
  "normalized_official_receipt_number", "official_receipt_number", "source_type", "payment_id", "created_at"
)
SELECT DISTINCT ON (public.normalize_treasury_or_number(payment."official_receipt_number"))
  public.normalize_treasury_or_number(payment."official_receipt_number"),
  BTRIM(payment."official_receipt_number"),
  'RESERVATION_PAYMENT',
  payment."id",
  payment."created_at"
FROM "payments" payment
WHERE payment."collection_channel" = 'TREASURER'::"collection_channel"
  AND public.normalize_treasury_or_number(payment."official_receipt_number") IS NOT NULL
ORDER BY public.normalize_treasury_or_number(payment."official_receipt_number"), payment."paid_at", payment."id"
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.register_payment_treasury_or()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."collection_channel" <> 'TREASURER'::"collection_channel"
    OR public.normalize_treasury_or_number(NEW."official_receipt_number") IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
    AND OLD."collection_channel" = NEW."collection_channel"
    AND public.normalize_treasury_or_number(OLD."official_receipt_number")
      IS NOT DISTINCT FROM public.normalize_treasury_or_number(NEW."official_receipt_number") THEN
    RETURN NEW;
  END IF;
  INSERT INTO "treasury_official_receipts" (
    "normalized_official_receipt_number", "official_receipt_number", "source_type", "payment_id"
  ) VALUES (
    public.normalize_treasury_or_number(NEW."official_receipt_number"),
    BTRIM(NEW."official_receipt_number"),
    'RESERVATION_PAYMENT',
    NEW."id"
  );
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.register_walk_in_treasury_or()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."collection_channel" <> 'TREASURER'::"collection_channel"
    OR public.normalize_treasury_or_number(NEW."official_receipt_number") IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
    AND OLD."collection_channel" = NEW."collection_channel"
    AND public.normalize_treasury_or_number(OLD."official_receipt_number")
      IS NOT DISTINCT FROM public.normalize_treasury_or_number(NEW."official_receipt_number") THEN
    RETURN NEW;
  END IF;
  INSERT INTO "treasury_official_receipts" (
    "normalized_official_receipt_number", "official_receipt_number", "source_type", "walk_in_sale_id"
  ) VALUES (
    public.normalize_treasury_or_number(NEW."official_receipt_number"),
    BTRIM(NEW."official_receipt_number"),
    'WALK_IN_SALE',
    NEW."id"
  );
  RETURN NEW;
END
$$;

CREATE TRIGGER "payments_register_treasury_or"
  AFTER INSERT OR UPDATE OF "official_receipt_number", "collection_channel" ON "payments"
  FOR EACH ROW EXECUTE FUNCTION public.register_payment_treasury_or();

CREATE TRIGGER "walk_in_sales_register_treasury_or"
  AFTER INSERT OR UPDATE OF "official_receipt_number", "collection_channel" ON "walk_in_sales"
  FOR EACH ROW EXECUTE FUNCTION public.register_walk_in_treasury_or();

ALTER TABLE "treasury_official_receipts" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "treasury_official_receipts" FROM PUBLIC;

DO $$
DECLARE
  client_role TEXT;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.treasury_official_receipts FROM %I', client_role);
    END IF;
  END LOOP;
END
$$;

COMMIT;
