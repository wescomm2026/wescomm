BEGIN;

-- Prevent restriction writes between duplicate cleanup and index creation.
LOCK TABLE public.account_restrictions IN SHARE ROW EXCLUSIVE MODE;

-- Normalize timed restrictions that are still marked active after their window.
UPDATE public.account_restrictions
SET
  status = 'EXPIRED',
  updated_at = NOW()
WHERE status = 'ACTIVE'
  AND ends_at IS NOT NULL
  AND ends_at <= NOW();

-- Keep one deterministic active restriction per student. The strongest level
-- wins, followed by an indefinite/longer window and the latest record.
WITH ranked_active_restrictions AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY student_id
      ORDER BY
        level DESC,
        (ends_at IS NULL) DESC,
        ends_at DESC NULLS LAST,
        starts_at DESC,
        created_at DESC,
        id DESC
    ) AS active_rank
  FROM public.account_restrictions
  WHERE status = 'ACTIVE'
)
UPDATE public.account_restrictions AS restriction
SET
  status = 'LIFTED',
  lifted_at = COALESCE(restriction.lifted_at, NOW()),
  lift_reason = COALESCE(
    NULLIF(BTRIM(restriction.lift_reason), ''),
    'Automatically lifted while resolving duplicate active restrictions.'
  ),
  updated_at = NOW()
FROM ranked_active_restrictions AS ranked
WHERE restriction.id = ranked.id
  AND ranked.active_rank > 1;

CREATE UNIQUE INDEX account_restrictions_one_active_per_student_idx
  ON public.account_restrictions(student_id)
  WHERE status = 'ACTIVE';

COMMIT;
