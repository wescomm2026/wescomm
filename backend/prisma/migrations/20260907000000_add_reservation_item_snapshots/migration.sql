BEGIN;

ALTER TABLE "reservation_items"
  ADD COLUMN "product_name_snapshot" TEXT,
  ADD COLUMN "sku_code_snapshot" TEXT,
  ADD COLUMN "option_snapshot" JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE "reservation_items" AS reservation_item
SET
  "product_name_snapshot" = product."name"
FROM "products" AS product
WHERE product."id" = reservation_item."product_id";

UPDATE "reservation_items" AS reservation_item
SET
  "sku_code_snapshot" = sku."code",
  "option_snapshot" = COALESCE(sku."option_snapshot", '[]'::jsonb)
FROM "product_skus" AS sku
WHERE sku."id" = reservation_item."sku_id";

UPDATE "reservation_items"
SET "product_name_snapshot" = 'Campus Item'
WHERE "product_name_snapshot" IS NULL;

ALTER TABLE "reservation_items"
  ALTER COLUMN "product_name_snapshot" SET NOT NULL;

COMMIT;
