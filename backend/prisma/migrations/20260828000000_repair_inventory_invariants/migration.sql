BEGIN;

-- Preserve an auditable adjustment for legacy variant quantities that are no longer
-- authoritative once a product is sold as SIMPLE or CLOTH_ONLY.
INSERT INTO public.inventory_movements (
  product_id,
  variant_id,
  type,
  quantity,
  previous_stock,
  new_stock,
  notes
)
SELECT
  pv.product_id,
  pv.id,
  'ADJUSTMENT'::public.inventory_movement_type,
  -pv.stock,
  pv.stock,
  0,
  'Cleared legacy option stock after the product moved to aggregate inventory.'
FROM public.product_variants AS pv
INNER JOIN public.products AS p ON p.id = pv.product_id
WHERE p.sale_mode <> 'OPTIONS'::public.product_sale_mode
  AND pv.stock <> 0;

UPDATE public.product_variants AS pv
SET
  stock = 0,
  updated_at = CURRENT_TIMESTAMP
FROM public.products AS p
WHERE p.id = pv.product_id
  AND p.sale_mode <> 'OPTIONS'::public.product_sale_mode
  AND pv.stock <> 0;

-- A non-option product must never retain live SKU inventory. Historical retired
-- SKU rows remain available for completed reservation and movement references.
UPDATE public.product_skus AS ps
SET
  is_active = false,
  updated_at = CURRENT_TIMESTAMP
FROM public.products AS p
WHERE p.id = ps.product_id
  AND p.sale_mode <> 'OPTIONS'::public.product_sale_mode
  AND ps.is_active = true;

UPDATE public.products
SET
  sku_inventory_enabled = false,
  inventory_reconciled_at = NULL,
  updated_at = CURRENT_TIMESTAMP
WHERE sale_mode <> 'OPTIONS'::public.product_sale_mode
  AND (sku_inventory_enabled = true OR inventory_reconciled_at IS NOT NULL);

-- One-group legacy products are mathematically unambiguous only when their option
-- total already equals aggregate available stock and no reservation hold exists.
-- Reconcile only that provably safe subset. Multi-group or mismatched products stay
-- paused for an explicit physical count in the staff dashboard.
CREATE TEMPORARY TABLE wescomm_safe_sku_reconciliation (
  product_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  sku_id uuid NOT NULL,
  code text NOT NULL,
  stock integer NOT NULL,
  low_stock_threshold integer NOT NULL,
  option_name text NOT NULL,
  option_value text NOT NULL
) ON COMMIT DROP;

INSERT INTO wescomm_safe_sku_reconciliation (
  product_id,
  variant_id,
  sku_id,
  code,
  stock,
  low_stock_threshold,
  option_name,
  option_value
)
SELECT
  pv.product_id,
  pv.id,
  gen_random_uuid(),
  'SKU-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
  pv.stock,
  pv.low_stock_threshold,
  pv.option_name,
  pv.option_value
FROM public.product_variants AS pv
INNER JOIN public.products AS p ON p.id = pv.product_id
WHERE p.sale_mode = 'OPTIONS'::public.product_sale_mode
  AND p.sku_inventory_enabled = false
  AND NOT EXISTS (
    SELECT 1
    FROM public.product_skus AS active_sku
    WHERE active_sku.product_id = p.id
      AND active_sku.is_active = true
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.reservation_items AS ri
    INNER JOIN public.reservations AS r ON r.id = ri.reservation_id
    WHERE ri.product_id = p.id
      AND r.status IN (
        'PENDING'::public.reservation_status,
        'CONFIRMED'::public.reservation_status,
        'READY_FOR_PICKUP'::public.reservation_status
      )
  )
  AND (
    SELECT COUNT(DISTINCT lower(regexp_replace(trim(group_variant.option_name), '\s+', ' ', 'g')))
    FROM public.product_variants AS group_variant
    WHERE group_variant.product_id = p.id
  ) = 1
  AND (
    SELECT COALESCE(SUM(stock), 0)
    FROM public.product_variants AS stock_variant
    WHERE stock_variant.product_id = p.id
  ) = p.stock;

INSERT INTO public.product_skus (
  id,
  product_id,
  code,
  stock,
  low_stock_threshold,
  is_active,
  option_snapshot
)
SELECT
  safe.sku_id,
  safe.product_id,
  safe.code,
  safe.stock,
  safe.low_stock_threshold,
  true,
  jsonb_build_array(jsonb_build_object(
    'variantId', safe.variant_id,
    'optionName', safe.option_name,
    'optionValue', safe.option_value
  ))
FROM wescomm_safe_sku_reconciliation AS safe;

INSERT INTO public.product_sku_variants (sku_id, variant_id)
SELECT sku_id, variant_id
FROM wescomm_safe_sku_reconciliation;

INSERT INTO public.inventory_movements (
  product_id,
  type,
  quantity,
  previous_stock,
  new_stock,
  notes
)
SELECT DISTINCT
  safe.product_id,
  'ADJUSTMENT'::public.inventory_movement_type,
  0,
  p.stock,
  p.stock,
  'Reconciled an unambiguous one-group legacy inventory into physical SKUs.'
FROM wescomm_safe_sku_reconciliation AS safe
INNER JOIN public.products AS p ON p.id = safe.product_id;

UPDATE public.products AS p
SET
  sku_inventory_enabled = true,
  inventory_reconciled_at = CURRENT_TIMESTAMP,
  updated_at = CURRENT_TIMESTAMP
WHERE p.id IN (
  SELECT DISTINCT product_id
  FROM wescomm_safe_sku_reconciliation
);

-- Defense in depth for writes outside the application services. Some managed
-- databases already carry the stock constraints from an earlier hotfix, so add
-- each named constraint only when the catalog says it is missing.
DO $inventory_constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'products_stock_nonnegative'
      AND conrelid = 'public.products'::regclass
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_stock_nonnegative CHECK (stock >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'products_low_stock_threshold_nonnegative'
      AND conrelid = 'public.products'::regclass
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_low_stock_threshold_nonnegative CHECK (low_stock_threshold >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'product_variants_stock_nonnegative'
      AND conrelid = 'public.product_variants'::regclass
  ) THEN
    ALTER TABLE public.product_variants
      ADD CONSTRAINT product_variants_stock_nonnegative CHECK (stock >= 0);
  END IF;
END
$inventory_constraints$;

COMMIT;
