BEGIN;

CREATE TABLE "rate_limit_counters" (
  "key_hash" CHAR(64) NOT NULL,
  "count" INTEGER NOT NULL,
  "reset_at" TIMESTAMPTZ(6) NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rate_limit_counters_pkey" PRIMARY KEY ("key_hash")
);

CREATE INDEX "rate_limit_counters_reset_at_idx"
  ON "rate_limit_counters"("reset_at");

ALTER TABLE "rate_limit_counters" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "rate_limit_counters" FROM PUBLIC;

DO $block$
DECLARE
  client_role text;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE "rate_limit_counters" FROM %I', client_role);
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL PRIVILEGES ON TABLE "rate_limit_counters" TO service_role;
  END IF;
END
$block$;

COMMIT;
