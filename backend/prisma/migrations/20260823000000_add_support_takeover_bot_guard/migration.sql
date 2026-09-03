-- Keep WesBot's final write linearizable with Staff ownership changes. The
-- model lookup can take long enough for Staff to take over while a reply is
-- being prepared, so the mode check and insert must happen under one row lock.
CREATE OR REPLACE FUNCTION "insert_active_wesbot_reply"(
  "p_conversation_id" UUID,
  "p_message" TEXT,
  "p_intent" TEXT,
  "p_metadata" JSONB,
  "p_category" TEXT,
  "p_last_intent" TEXT,
  "p_last_concern_key" TEXT,
  "p_bot_reply_count" INTEGER,
  "p_reply_to_message_id" UUID
)
RETURNS SETOF "conversation_messages"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  "current_conversation" "conversations"%ROWTYPE;
  "inserted_message" "conversation_messages"%ROWTYPE;
BEGIN
  SELECT *
  INTO "current_conversation"
  FROM "conversations"
  WHERE "id" = "p_conversation_id"
  FOR UPDATE;

  IF NOT FOUND
    OR "current_conversation"."status" <> 'OPEN'::"ConversationStatus"
    OR "current_conversation"."mode" <> 'BOT_ACTIVE'::"ConversationMode"
  THEN
    RETURN;
  END IF;

  IF "p_reply_to_message_id" IS NOT NULL THEN
    SELECT *
    INTO "inserted_message"
    FROM "conversation_messages"
    WHERE "conversation_id" = "p_conversation_id"
      AND "sender_type" = 'BOT'::"ConversationMessageSenderType"
      AND "metadata" ->> 'replyToMessageId' = "p_reply_to_message_id"::TEXT
    ORDER BY "created_at" ASC
    LIMIT 1;

    IF FOUND THEN
      RETURN NEXT "inserted_message";
      RETURN;
    END IF;
  END IF;

  INSERT INTO "conversation_messages" (
    "conversation_id",
    "sender_id",
    "sender_type",
    "message",
    "intent",
    "metadata"
  )
  VALUES (
    "p_conversation_id",
    NULL,
    'BOT'::"ConversationMessageSenderType",
    "p_message",
    "p_intent",
    COALESCE("p_metadata", '{}'::JSONB)
  )
  RETURNING * INTO "inserted_message";

  UPDATE "conversations"
  SET
    "category" = "p_category",
    "last_intent" = "p_last_intent",
    "last_concern_key" = "p_last_concern_key",
    "bot_reply_count" = "p_bot_reply_count",
    "updated_at" = "inserted_message"."created_at"
  WHERE "id" = "p_conversation_id";

  RETURN NEXT "inserted_message";
END;
$$;

REVOKE ALL ON FUNCTION "insert_active_wesbot_reply"(UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, INTEGER, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION "insert_active_wesbot_reply"(UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, INTEGER, UUID) FROM anon;
REVOKE ALL ON FUNCTION "insert_active_wesbot_reply"(UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, INTEGER, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION "insert_active_wesbot_reply"(UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, INTEGER, UUID) TO service_role;

-- Enforce the same single-writer rule for Staff replies. A preflight owner
-- check in application code is not enough because ownership can transfer
-- between that check and the message insert.
CREATE OR REPLACE FUNCTION "insert_owned_staff_message"(
  "p_conversation_id" UUID,
  "p_staff_id" UUID,
  "p_message" TEXT
)
RETURNS SETOF "conversation_messages"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  "current_conversation" "conversations"%ROWTYPE;
  "inserted_message" "conversation_messages"%ROWTYPE;
BEGIN
  SELECT *
  INTO "current_conversation"
  FROM "conversations"
  WHERE "id" = "p_conversation_id"
  FOR UPDATE;

  IF NOT FOUND
    OR "current_conversation"."status" <> 'OPEN'::"ConversationStatus"
    OR "current_conversation"."mode" <> 'STAFF_ACTIVE'::"ConversationMode"
    OR "current_conversation"."assigned_staff_id" IS DISTINCT FROM "p_staff_id"
  THEN
    RETURN;
  END IF;

  INSERT INTO "conversation_messages" (
    "conversation_id",
    "sender_id",
    "sender_type",
    "message",
    "metadata"
  )
  VALUES (
    "p_conversation_id",
    "p_staff_id",
    'STAFF'::"ConversationMessageSenderType",
    "p_message",
    '{}'::JSONB
  )
  RETURNING * INTO "inserted_message";

  UPDATE "conversations"
  SET
    "accepted_at" = COALESCE("accepted_at", "inserted_message"."created_at"),
    "updated_at" = "inserted_message"."created_at"
  WHERE "id" = "p_conversation_id";

  RETURN NEXT "inserted_message";
END;
$$;

REVOKE ALL ON FUNCTION "insert_owned_staff_message"(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION "insert_owned_staff_message"(UUID, UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION "insert_owned_staff_message"(UUID, UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION "insert_owned_staff_message"(UUID, UUID, TEXT) TO service_role;
