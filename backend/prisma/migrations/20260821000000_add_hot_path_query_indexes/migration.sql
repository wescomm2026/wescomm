-- These indexes match the bounded list, dashboard, notification badge, and
-- reservation/inventory relation queries used by the application hot paths.
CREATE INDEX IF NOT EXISTS "products_is_active_status_idx"
  ON "products"("is_active", "status");

CREATE INDEX IF NOT EXISTS "inventory_movements_product_id_created_at_idx"
  ON "inventory_movements"("product_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "inventory_movements_variant_id_created_at_idx"
  ON "inventory_movements"("variant_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "reservations_student_id_created_at_idx"
  ON "reservations"("student_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "reservations_status_created_at_idx"
  ON "reservations"("status", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "reservation_items_reservation_id_idx"
  ON "reservation_items"("reservation_id");

CREATE INDEX IF NOT EXISTS "reservation_items_product_id_idx"
  ON "reservation_items"("product_id");

CREATE INDEX IF NOT EXISTS "receipts_student_id_issued_at_idx"
  ON "receipts"("student_id", "issued_at" DESC);

CREATE INDEX IF NOT EXISTS "receipts_status_issued_at_idx"
  ON "receipts"("status", "issued_at" DESC);

CREATE INDEX IF NOT EXISTS "receipts_reservation_id_idx"
  ON "receipts"("reservation_id");

CREATE INDEX IF NOT EXISTS "notifications_user_id_read_at_created_at_idx"
  ON "notifications"("user_id", "read_at", "created_at" DESC);

-- Idempotency for the client-orchestrated WesBot reply request. The student
-- message is committed and acknowledged before grounded answer generation.
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_messages_bot_reply_source_key"
  ON "conversation_messages"("conversation_id", ("metadata"->>'replyToMessageId'))
  WHERE "sender_type" = 'BOT' AND "metadata" ? 'replyToMessageId';
