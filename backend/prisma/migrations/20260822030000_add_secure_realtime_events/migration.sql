BEGIN;

CREATE TABLE "realtime_events" (
  "id" BIGSERIAL NOT NULL,
  "topic" VARCHAR(80) NOT NULL,
  "dedupe_key" TEXT,
  "audience_user_id" UUID,
  "audience_role" "app_role",
  "entity_id" UUID,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(6) NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '1 day'),

  CONSTRAINT "realtime_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "realtime_events_exactly_one_audience_check"
    CHECK (("audience_user_id" IS NOT NULL) <> ("audience_role" IS NOT NULL)),
  CONSTRAINT "realtime_events_audience_user_id_fkey"
    FOREIGN KEY ("audience_user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "realtime_events_audience_user_id_id_idx"
ON "realtime_events"("audience_user_id", "id");

CREATE INDEX "realtime_events_audience_role_id_idx"
ON "realtime_events"("audience_role", "id");

CREATE INDEX "realtime_events_expires_at_idx"
ON "realtime_events"("expires_at");

CREATE UNIQUE INDEX "realtime_events_dedupe_key_key"
ON "realtime_events"("dedupe_key");

ALTER TABLE "realtime_events" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "realtime_events" FROM PUBLIC;
REVOKE ALL PRIVILEGES ON SEQUENCE "realtime_events_id_seq" FROM PUBLIC;

DO $block$
DECLARE
  client_role text;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE "realtime_events" FROM %I', client_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON SEQUENCE "realtime_events_id_seq" FROM %I', client_role);
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL PRIVILEGES ON TABLE "realtime_events" TO service_role;
    GRANT USAGE, SELECT ON SEQUENCE "realtime_events_id_seq" TO service_role;
  END IF;
END
$block$;

COMMIT;
