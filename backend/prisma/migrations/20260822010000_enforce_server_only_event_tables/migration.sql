BEGIN;

-- These records are exposed only through the authenticated Express API.
-- Remove legacy browser policies that may have been created before the
-- backend-only database boundary was introduced.
DO $block$
DECLARE
  policy_record record;
BEGIN
  FOR policy_record IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'online_payments',
        'online_payment_attempts',
        'paymongo_webhook_events',
        'audit_logs',
        'outbox_events'
      )
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      policy_record.policyname,
      policy_record.tablename
    );
  END LOOP;
END
$block$;

COMMIT;
