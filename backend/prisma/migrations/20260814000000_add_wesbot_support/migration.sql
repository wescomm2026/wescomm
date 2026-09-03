-- WesBot adds an explicit bot/staff lifecycle without changing the existing
-- OPEN/RESOLVED reporting contract. Existing open conversations are kept in a
-- human-owned state so deployment never causes surprise automatic replies.
CREATE TYPE "conversation_mode" AS ENUM (
  'BOT_ACTIVE',
  'WAITING_FOR_STAFF',
  'STAFF_ACTIVE',
  'RESOLVED'
);

CREATE TYPE "conversation_message_sender_type" AS ENUM (
  'STUDENT',
  'BOT',
  'STAFF',
  'SYSTEM'
);

ALTER TABLE "conversations"
  ADD COLUMN "mode" "conversation_mode" NOT NULL DEFAULT 'BOT_ACTIVE',
  ADD COLUMN "category" TEXT,
  ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "escalation_reason" TEXT,
  ADD COLUMN "escalated_at" TIMESTAMPTZ(6),
  ADD COLUMN "accepted_at" TIMESTAMPTZ(6),
  ADD COLUMN "resolved_at" TIMESTAMPTZ(6),
  ADD COLUMN "bot_summary" TEXT,
  ADD COLUMN "last_intent" TEXT,
  ADD COLUMN "last_concern_key" TEXT,
  ADD COLUMN "bot_reply_count" INTEGER NOT NULL DEFAULT 0;

UPDATE "conversations"
SET "mode" = CASE
  WHEN "status" = 'RESOLVED' THEN 'RESOLVED'::"conversation_mode"
  WHEN "assigned_staff_id" IS NOT NULL THEN 'STAFF_ACTIVE'::"conversation_mode"
  ELSE 'WAITING_FOR_STAFF'::"conversation_mode"
END,
"resolved_at" = CASE WHEN "status" = 'RESOLVED' THEN "updated_at" ELSE NULL END;

ALTER TABLE "conversations"
  ADD CONSTRAINT "conversations_priority_check" CHECK ("priority" >= 0 AND "priority" <= 3),
  ADD CONSTRAINT "conversations_status_mode_check" CHECK (
    ("status" = 'RESOLVED' AND "mode" = 'RESOLVED') OR
    ("status" = 'OPEN' AND "mode" <> 'RESOLVED')
  );

ALTER TABLE "conversation_messages"
  ADD COLUMN "sender_type" "conversation_message_sender_type" NOT NULL DEFAULT 'STUDENT',
  ADD COLUMN "intent" TEXT,
  ADD COLUMN "metadata" JSONB NOT NULL DEFAULT '{}'::JSONB;

UPDATE "conversation_messages" AS message
SET "sender_type" = CASE
  WHEN profile."role" IN ('STAFF', 'ADMIN') THEN 'STAFF'::"conversation_message_sender_type"
  ELSE 'STUDENT'::"conversation_message_sender_type"
END
FROM "profiles" AS profile
WHERE profile."id" = message."sender_id";

ALTER TABLE "conversation_messages"
  DROP CONSTRAINT "conversation_messages_sender_id_fkey";

ALTER TABLE "conversation_messages"
  ALTER COLUMN "sender_id" DROP NOT NULL;

ALTER TABLE "conversation_messages"
  ADD CONSTRAINT "conversation_messages_sender_id_fkey"
    FOREIGN KEY ("sender_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "conversation_messages_sender_identity_check" CHECK (
    ("sender_type" IN ('BOT', 'SYSTEM') AND "sender_id" IS NULL) OR
    ("sender_type" IN ('STUDENT', 'STAFF') AND "sender_id" IS NOT NULL)
  );

CREATE INDEX "conversations_mode_priority_updated_at_idx"
  ON "conversations"("mode", "priority", "updated_at" DESC);

CREATE INDEX "conversations_student_id_updated_at_idx"
  ON "conversations"("student_id", "updated_at" DESC);

CREATE INDEX "conversation_messages_conversation_id_created_at_idx"
  ON "conversation_messages"("conversation_id", "created_at");
