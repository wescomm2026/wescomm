BEGIN;

ALTER TABLE "audit_logs"
  ADD COLUMN IF NOT EXISTS "dedupe_key" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "audit_logs_dedupe_key_key"
  ON "audit_logs"("dedupe_key");

CREATE TABLE IF NOT EXISTS "outbox_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "type" TEXT NOT NULL,
  "entity_id" UUID,
  "payload" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locked_at" TIMESTAMPTZ(6),
  "processed_at" TIMESTAMPTZ(6),
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "outbox_events_processed_at_available_at_created_at_idx"
  ON "outbox_events"("processed_at", "available_at", "created_at");

CREATE INDEX IF NOT EXISTS "outbox_events_type_entity_id_idx"
  ON "outbox_events"("type", "entity_id");

CREATE INDEX IF NOT EXISTS "outbox_events_ready_idx"
  ON "outbox_events"("available_at", "created_at", "id")
  WHERE "processed_at" IS NULL;

CREATE INDEX IF NOT EXISTS "profiles_created_at_id_idx"
  ON "profiles"("created_at" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS "profiles_role_created_at_id_idx"
  ON "profiles"("role", "created_at" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS "products_is_active_name_id_idx"
  ON "products"("is_active", "name" ASC, "id" ASC);

CREATE INDEX IF NOT EXISTS "reservations_student_id_created_at_id_idx"
  ON "reservations"("student_id", "created_at" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS "reservations_status_created_at_id_idx"
  ON "reservations"("status", "created_at" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS "receipts_student_id_issued_at_id_idx"
  ON "receipts"("student_id", "issued_at" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS "receipts_status_issued_at_id_idx"
  ON "receipts"("status", "issued_at" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS "audit_logs_created_at_id_idx"
  ON "audit_logs"("created_at" DESC, "id" DESC);

ALTER TABLE "outbox_events" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "outbox_events" FROM PUBLIC;

DO $block$
DECLARE
  client_role text;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE "outbox_events" FROM %I', client_role);
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL PRIVILEGES ON TABLE "outbox_events" TO service_role;
  END IF;
END
$block$;

COMMIT;
