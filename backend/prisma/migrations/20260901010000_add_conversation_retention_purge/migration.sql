BEGIN;

ALTER TABLE "conversations"
ADD COLUMN "deleted_at" TIMESTAMPTZ(6),
ADD COLUMN "deleted_by_id" UUID,
ADD COLUMN "purge_eligible_at" TIMESTAMPTZ(6);

ALTER TABLE "conversations"
ADD CONSTRAINT "conversations_deleted_by_id_fkey"
FOREIGN KEY ("deleted_by_id") REFERENCES "profiles"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "conversations"
ADD CONSTRAINT "conversations_retention_state_check"
CHECK (
  ("deleted_at" IS NULL AND "deleted_by_id" IS NULL AND "purge_eligible_at" IS NULL)
  OR
  ("deleted_at" IS NOT NULL AND "purge_eligible_at" IS NOT NULL)
);

CREATE INDEX "conversations_deleted_at_purge_eligible_at_idx"
ON "conversations"("deleted_at", "purge_eligible_at");

CREATE TABLE "conversation_purge_records" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "conversation_id" UUID NOT NULL,
  "purged_by_id" UUID,
  "idempotency_key" TEXT NOT NULL,
  "preview_fingerprint" TEXT NOT NULL,
  "message_count" INTEGER NOT NULL,
  "revision_count" INTEGER NOT NULL,
  "soft_deleted_at" TIMESTAMPTZ(6) NOT NULL,
  "purge_eligible_at" TIMESTAMPTZ(6) NOT NULL,
  "purged_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "conversation_purge_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "conversation_purge_records_purged_by_id_fkey"
    FOREIGN KEY ("purged_by_id") REFERENCES "profiles"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "conversation_purge_records_counts_check"
    CHECK ("message_count" >= 0 AND "revision_count" >= 0)
);

CREATE UNIQUE INDEX "conversation_purge_records_conversation_id_key"
ON "conversation_purge_records"("conversation_id");

CREATE UNIQUE INDEX "conversation_purge_records_idempotency_key_key"
ON "conversation_purge_records"("idempotency_key");

CREATE INDEX "conversation_purge_records_purged_at_idx"
ON "conversation_purge_records"("purged_at" DESC);

CREATE INDEX "conversation_purge_records_purged_by_id_purged_at_idx"
ON "conversation_purge_records"("purged_by_id", "purged_at" DESC);

DO $block$
DECLARE
  client_role text;
BEGIN
  ALTER TABLE public.conversation_purge_records ENABLE ROW LEVEL SECURITY;
  REVOKE ALL PRIVILEGES ON TABLE public.conversation_purge_records FROM PUBLIC;
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE public.conversation_purge_records FROM %I',
        client_role
      );
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL PRIVILEGES ON TABLE public.conversation_purge_records TO service_role;
  END IF;
END
$block$;

COMMIT;
