-- A lone value inside an option group has no allocation ambiguity: every
-- physical unit belongs to that value. Older staff restocks changed only the
-- parent product stock, which left singleton options (for example,
-- Copy: Standard) at zero and made otherwise available products impossible to
-- reserve. Record the repair, align each safe singleton group, and notify
-- students whose watched product becomes genuinely orderable.
WITH singleton_option_mismatches AS MATERIALIZED (
  SELECT
    pv.id AS variant_id,
    pv.product_id,
    pv.stock AS previous_stock,
    p.stock AS new_stock
  FROM public.product_variants pv
  JOIN public.products p ON p.id = pv.product_id
  WHERE pv.stock <> p.stock
    AND (
      SELECT COUNT(*)
      FROM public.product_variants siblings
      WHERE siblings.product_id = pv.product_id
        AND LOWER(BTRIM(siblings.option_name)) = LOWER(BTRIM(pv.option_name))
    ) = 1
), recorded_repairs AS (
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
    product_id,
    variant_id,
    'ADJUSTMENT'::public.inventory_movement_type,
    new_stock - previous_stock,
    previous_stock,
    new_stock,
    'Reconciled singleton option stock with the authoritative product total.'
  FROM singleton_option_mismatches
  RETURNING id
), updated_variants AS (
  UPDATE public.product_variants variant
  SET
    stock = mismatch.new_stock,
    updated_at = CURRENT_TIMESTAMP
  FROM singleton_option_mismatches mismatch
  WHERE variant.id = mismatch.variant_id
  RETURNING variant.product_id
), newly_available_products AS (
  SELECT DISTINCT updated.product_id
  FROM updated_variants updated
  JOIN public.products product ON product.id = updated.product_id
  WHERE product.is_active = TRUE
    AND product.stock > 0
    AND product.status <> 'OUT_OF_STOCK'::public.product_status
    AND EXISTS (
      SELECT 1
      FROM public.product_variants previous_variant
      WHERE previous_variant.product_id = updated.product_id
      GROUP BY LOWER(BTRIM(previous_variant.option_name))
      HAVING MAX(previous_variant.stock) <= 0
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.product_variants next_variant
      LEFT JOIN singleton_option_mismatches repaired
        ON repaired.variant_id = next_variant.id
      WHERE next_variant.product_id = updated.product_id
      GROUP BY LOWER(BTRIM(next_variant.option_name))
      HAVING MAX(COALESCE(repaired.new_stock, next_variant.stock)) <= 0
    )
)
INSERT INTO public.notifications (
  user_id,
  type,
  title,
  message,
  action_url,
  dedupe_key
)
SELECT
  wishlist.user_id,
  'BACK_IN_STOCK'::public.notification_type,
  product.name || ' is back in stock',
  product.name || ' is available again. Open your wishlist to view the item.',
  '/student/shop?wishlist=1&product=' || product.id::text,
  'back-in-stock:singleton-option-reconcile:' || product.id::text || ':' || wishlist.user_id::text
FROM newly_available_products available
JOIN public.products product ON product.id = available.product_id
JOIN public.wishlist_items wishlist ON wishlist.product_id = product.id
JOIN public.profiles profile ON profile.id = wishlist.user_id
WHERE profile.role = 'STUDENT'::public.app_role
ON CONFLICT (dedupe_key) DO NOTHING;
