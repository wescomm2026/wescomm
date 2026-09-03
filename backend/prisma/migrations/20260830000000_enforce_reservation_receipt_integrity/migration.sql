BEGIN;

DO $block$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.receipts
    WHERE reservation_id IS NOT NULL
    GROUP BY reservation_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce one receipt per reservation: duplicate receipts exist. Run npm run receipts:integrity:audit and review the affected financial records.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.receipts AS receipt
    INNER JOIN public.reservations AS reservation
      ON reservation.id = receipt.reservation_id
    WHERE reservation.status <> 'COMPLETED'::public.reservation_status
      OR receipt.student_id <> reservation.student_id
      OR receipt.total_amount IS DISTINCT FROM reservation.total_amount
      OR receipt.payment_method IS DISTINCT FROM reservation.payment_method
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce reservation receipt integrity: linked receipt data disagrees with its reservation. Run npm run receipts:integrity:audit and review the affected financial records.';
  END IF;
END
$block$;

DROP INDEX IF EXISTS public.receipts_reservation_id_idx;

CREATE UNIQUE INDEX "receipts_reservation_id_key"
  ON public.receipts("reservation_id");

COMMIT;
