-- Add an independent low-stock threshold for each product option/size.
-- Existing variants receive a conservative default of 2 pieces.
ALTER TABLE "product_variants"
  ADD COLUMN "low_stock_threshold" INTEGER NOT NULL DEFAULT 2;

ALTER TABLE "product_variants"
  ADD CONSTRAINT "product_variants_low_stock_threshold_nonnegative"
  CHECK ("low_stock_threshold" >= 0);
