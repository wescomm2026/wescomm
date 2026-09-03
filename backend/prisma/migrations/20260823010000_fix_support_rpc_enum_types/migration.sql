BEGIN;

CREATE OR REPLACE FUNCTION public.insert_active_wesbot_reply(
  p_conversation_id uuid,
  p_message text,
  p_intent text,
  p_metadata jsonb,
  p_category text,
  p_last_intent text,
  p_last_concern_key text,
  p_bot_reply_count integer,
  p_reply_to_message_id uuid
)
RETURNS SETOF conversation_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  "current_conversation" "conversations"%ROWTYPE;
  "inserted_message" "conversation_messages"%ROWTYPE;
BEGIN
  SELECT * INTO "current_conversation"
  FROM "conversations"
  WHERE "id" = "p_conversation_id"
  FOR UPDATE;

  IF NOT FOUND
    OR "current_conversation"."status" <> 'OPEN'::"conversation_status"
    OR "current_conversation"."mode" <> 'BOT_ACTIVE'::"conversation_mode"
  THEN
    RETURN;
  END IF;

  IF "p_reply_to_message_id" IS NOT NULL THEN
    SELECT * INTO "inserted_message"
    FROM "conversation_messages"
    WHERE "conversation_id" = "p_conversation_id"
      AND "sender_type" = 'BOT'::"conversation_message_sender_type"
      AND "metadata" ->> 'replyToMessageId' = "p_reply_to_message_id"::TEXT
    ORDER BY "created_at" ASC
    LIMIT 1;
    IF FOUND THEN
      RETURN NEXT "inserted_message";
      RETURN;
    END IF;
  END IF;

  INSERT INTO "conversation_messages" ("conversation_id", "sender_id", "sender_type", "message", "intent", "metadata")
  VALUES ("p_conversation_id", NULL, 'BOT'::"conversation_message_sender_type", "p_message", "p_intent", COALESCE("p_metadata", '{}'::JSONB))
  RETURNING * INTO "inserted_message";

  UPDATE "conversations"
  SET "category" = "p_category",
      "last_intent" = "p_last_intent",
      "last_concern_key" = "p_last_concern_key",
      "bot_reply_count" = "p_bot_reply_count",
      "updated_at" = "inserted_message"."created_at"
  WHERE "id" = "p_conversation_id";

  RETURN NEXT "inserted_message";
END;
$function$;

CREATE OR REPLACE FUNCTION public.insert_owned_staff_message(
  p_conversation_id uuid,
  p_staff_id uuid,
  p_message text
)
RETURNS SETOF conversation_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  "current_conversation" "conversations"%ROWTYPE;
  "inserted_message" "conversation_messages"%ROWTYPE;
BEGIN
  SELECT * INTO "current_conversation"
  FROM "conversations"
  WHERE "id" = "p_conversation_id"
  FOR UPDATE;

  IF NOT FOUND
    OR "current_conversation"."status" <> 'OPEN'::"conversation_status"
    OR "current_conversation"."mode" <> 'STAFF_ACTIVE'::"conversation_mode"
    OR "current_conversation"."assigned_staff_id" IS DISTINCT FROM "p_staff_id"
  THEN
    RETURN;
  END IF;

  INSERT INTO "conversation_messages" ("conversation_id", "sender_id", "sender_type", "message", "metadata")
  VALUES ("p_conversation_id", "p_staff_id", 'STAFF'::"conversation_message_sender_type", "p_message", '{}'::JSONB)
  RETURNING * INTO "inserted_message";

  UPDATE "conversations"
  SET "accepted_at" = COALESCE("accepted_at", "inserted_message"."created_at"),
      "updated_at" = "inserted_message"."created_at"
  WHERE "id" = "p_conversation_id";

  RETURN NEXT "inserted_message";
END;
$function$;

COMMIT;
