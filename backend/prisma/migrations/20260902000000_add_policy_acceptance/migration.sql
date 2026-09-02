BEGIN;

CREATE TABLE "policy_acceptances" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "policy_version" VARCHAR(32) NOT NULL,
  "accepted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "policy_acceptances_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "policy_acceptances_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "profiles"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "policy_acceptances_policy_version_check"
    CHECK (char_length("policy_version") BETWEEN 1 AND 32)
);

CREATE UNIQUE INDEX "policy_acceptances_user_id_policy_version_key"
ON "policy_acceptances"("user_id", "policy_version");

CREATE INDEX "policy_acceptances_accepted_at_idx"
ON "policy_acceptances"("accepted_at" DESC);

ALTER TABLE "reservations"
  ADD COLUMN "checkout_policy_version" VARCHAR(32),
  ADD COLUMN "checkout_policy_accepted_at" TIMESTAMPTZ(6),
  ADD CONSTRAINT "reservations_checkout_policy_acceptance_check"
    CHECK (
      ("checkout_policy_version" IS NULL AND "checkout_policy_accepted_at" IS NULL)
      OR
      ("checkout_policy_version" IS NOT NULL AND "checkout_policy_accepted_at" IS NOT NULL)
    );

DO $block$
DECLARE
  client_role text;
BEGIN
  ALTER TABLE public.policy_acceptances ENABLE ROW LEVEL SECURITY;
  REVOKE ALL PRIVILEGES ON TABLE public.policy_acceptances FROM PUBLIC;
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE public.policy_acceptances FROM %I',
        client_role
      );
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL PRIVILEGES ON TABLE public.policy_acceptances TO service_role;
  END IF;
END
$block$;

COMMIT;
