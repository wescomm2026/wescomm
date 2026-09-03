BEGIN;

-- V8.1 corrective backfill.
-- V8 conservatively marked every non-uniform product with any legacy variant row as OPTIONS.
-- Some legacy rows are not a real student choice (for example a single value in an option group).
-- Only demote an OPTIONS product to SIMPLE when all of the following are true:
--   * it is not a Uniform product;
--   * SKU inventory has never been enabled and there are no active SKUs;
--   * no option group contains more than one distinct value.
-- This preserves true selectable products (for example Color/Clip Type or other multi-value groups).
UPDATE public.products p
SET sale_mode = 'SIMPLE'::public.product_sale_mode
WHERE p.sale_mode = 'OPTIONS'::public.product_sale_mode
  AND p.sku_inventory_enabled = false
  AND NOT EXISTS (
    SELECT 1
    FROM public.categories c
    WHERE c.id = p.category_id
      AND (
        lower(trim(c.name)) IN ('uniform', 'uniforms')
        OR lower(trim(c.slug)) IN ('uniform', 'uniforms')
      )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.product_skus ps
    WHERE ps.product_id = p.id
      AND ps.is_active = true
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.product_variants pv
    WHERE pv.product_id = p.id
    GROUP BY lower(trim(pv.option_name))
    HAVING COUNT(DISTINCT lower(trim(pv.option_value))) > 1
  );

COMMIT;
