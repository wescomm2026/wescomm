BEGIN;

CREATE TYPE "reservation_schedule_change_source" AS ENUM ('MANUAL', 'SYSTEM_CLOSURE');

ALTER TABLE "pickup_policy_versions"
  ADD COLUMN "activation_key" TEXT;

CREATE UNIQUE INDEX "pickup_policy_versions_activation_key_key"
  ON "pickup_policy_versions"("activation_key");

ALTER TABLE "reservation_schedule_changes"
  ADD COLUMN "source" "reservation_schedule_change_source" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "closure_id" UUID,
  ADD COLUMN "trigger_key" TEXT;

CREATE UNIQUE INDEX "reservation_schedule_changes_trigger_key_key"
  ON "reservation_schedule_changes"("trigger_key");
CREATE INDEX "reservation_schedule_changes_closure_id_created_at_idx"
  ON "reservation_schedule_changes"("closure_id", "created_at" DESC);

ALTER TABLE "reservation_schedule_changes"
  ADD CONSTRAINT "reservation_schedule_changes_closure_id_fkey"
  FOREIGN KEY ("closure_id") REFERENCES "pickup_closures"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "conversations"
  ADD COLUMN "student_archived_at" TIMESTAMPTZ(6),
  ADD COLUMN "operations_archived_at" TIMESTAMPTZ(6),
  ADD CONSTRAINT "conversations_archive_requires_resolved_check" CHECK (
    ("student_archived_at" IS NULL AND "operations_archived_at" IS NULL)
    OR "status" = 'RESOLVED'::"conversation_status"
  );

CREATE INDEX "conversations_student_archived_at_updated_at_idx"
  ON "conversations"("student_archived_at", "updated_at" DESC);
CREATE INDEX "conversations_operations_archived_at_updated_at_idx"
  ON "conversations"("operations_archived_at", "updated_at" DESC);

ALTER TABLE "conversation_messages"
  ADD COLUMN "edited_at" TIMESTAMPTZ(6),
  ADD COLUMN "edit_version" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "conversation_messages_edit_version_check" CHECK (
    ("edit_version" = 0 AND "edited_at" IS NULL)
    OR ("edit_version" > 0 AND "edited_at" IS NOT NULL)
  );

CREATE TABLE "conversation_message_revisions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "message_id" UUID NOT NULL,
  "edited_by_id" UUID NOT NULL,
  "edit_version" INTEGER NOT NULL,
  "previous_message" TEXT NOT NULL,
  "new_message" TEXT NOT NULL,
  "edited_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "conversation_message_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "conversation_message_revisions_edit_version_check" CHECK ("edit_version" > 0)
);

CREATE UNIQUE INDEX "conversation_message_revisions_message_id_edit_version_key"
  ON "conversation_message_revisions"("message_id", "edit_version");
CREATE INDEX "conversation_message_revisions_message_id_edited_at_idx"
  ON "conversation_message_revisions"("message_id", "edited_at" DESC);
CREATE INDEX "conversation_message_revisions_edited_by_id_edited_at_idx"
  ON "conversation_message_revisions"("edited_by_id", "edited_at" DESC);

ALTER TABLE "conversation_message_revisions"
  ADD CONSTRAINT "conversation_message_revisions_message_id_fkey"
  FOREIGN KEY ("message_id") REFERENCES "conversation_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "conversation_message_revisions_edited_by_id_fkey"
  FOREIGN KEY ("edited_by_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DO $block$
DECLARE
  client_role text;
BEGIN
  ALTER TABLE public.conversation_message_revisions ENABLE ROW LEVEL SECURITY;
  REVOKE ALL PRIVILEGES ON TABLE public.conversation_message_revisions FROM PUBLIC;
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE public.conversation_message_revisions FROM %I',
        client_role
      );
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL PRIVILEGES ON TABLE public.conversation_message_revisions TO service_role;
  END IF;
END
$block$;

COMMIT;
