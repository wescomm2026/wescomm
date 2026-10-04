BEGIN;

ALTER TABLE "receipts"
  DROP CONSTRAINT "receipts_student_id_fkey";

ALTER TABLE "receipts"
  ALTER COLUMN "student_id" DROP NOT NULL;

ALTER TABLE "receipts"
  ADD CONSTRAINT "receipts_student_id_fkey"
  FOREIGN KEY ("student_id") REFERENCES "profiles"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "receipts"
  ADD CONSTRAINT "receipts_reservation_requires_student_check"
  CHECK ("reservation_id" IS NULL OR "student_id" IS NOT NULL);

ALTER TABLE "walk_in_sales"
  ALTER COLUMN "student_id" DROP NOT NULL,
  ADD COLUMN "buyer_name_snapshot" TEXT;

UPDATE "walk_in_sales" AS sale
SET "buyer_name_snapshot" = COALESCE(
  NULLIF(BTRIM(profile."full_name"), ''),
  'Walk-in buyer'
)
FROM "profiles" AS profile
WHERE profile."id" = sale."student_id";

UPDATE "walk_in_sales"
SET "buyer_name_snapshot" = 'Walk-in buyer'
WHERE "buyer_name_snapshot" IS NULL;

ALTER TABLE "walk_in_sales"
  ALTER COLUMN "buyer_name_snapshot" SET NOT NULL,
  ADD CONSTRAINT "walk_in_sales_buyer_name_check"
  CHECK (CHAR_LENGTH(BTRIM("buyer_name_snapshot")) BETWEEN 2 AND 120);

COMMIT;
