BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'product_sale_mode'
  ) THEN
    CREATE TYPE public.product_sale_mode AS ENUM ('SIMPLE', 'CLOTH_ONLY', 'OPTIONS');
  END IF;
END
$$;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS sale_mode public.product_sale_mode NOT NULL DEFAULT 'SIMPLE';

-- Backfill conservatively from behavior already present before this migration:
-- 1) products already reconciled into SKU inventory remain OPTIONS;
-- 2) non-PE Uniforms keep the existing cloth-only student behavior;
-- 3) other products with option rows become OPTIONS and must be reconciled;
-- 4) everything else is a simple one-count item.
UPDATE public.products p
SET sale_mode = CASE
  WHEN p.sku_inventory_enabled THEN 'OPTIONS'::public.product_sale_mode
  WHEN EXISTS (
    SELECT 1
    FROM public.categories c
    WHERE c.id = p.category_id
      AND (lower(c.name) IN ('uniform', 'uniforms') OR lower(c.slug) IN ('uniform', 'uniforms'))
  )
  AND lower(p.name) ~ '(^|[^a-z])p\.?e\.?([^a-z]|$)|physical education|elementary pe'
    THEN 'OPTIONS'::public.product_sale_mode
  WHEN EXISTS (
    SELECT 1
    FROM public.categories c
    WHERE c.id = p.category_id
      AND (lower(c.name) IN ('uniform', 'uniforms') OR lower(c.slug) IN ('uniform', 'uniforms'))
  )
    THEN 'CLOTH_ONLY'::public.product_sale_mode
  WHEN EXISTS (
    SELECT 1
    FROM public.product_variants pv
    WHERE pv.product_id = p.id
  )
    THEN 'OPTIONS'::public.product_sale_mode
  ELSE 'SIMPLE'::public.product_sale_mode
END;

CREATE INDEX IF NOT EXISTS products_active_sale_mode_idx
  ON public.products (is_active, sale_mode);

COMMIT;
