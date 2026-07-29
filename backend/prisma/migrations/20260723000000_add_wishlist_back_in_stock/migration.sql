BEGIN;

-- Wishlist restock alerts use a distinct type so the application can route
-- students back to the relevant shop item without reusing staff low-stock
-- semantics.
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'BACK_IN_STOCK';

-- Notification delivery keys make one alert per student and stock-availability
-- event idempotent. The action URL is intentionally generic so notification
-- links do not require a second polymorphic relationship.
ALTER TABLE "notifications"
  ADD COLUMN "dedupe_key" TEXT,
  ADD COLUMN "action_url" TEXT;

CREATE UNIQUE INDEX "notifications_dedupe_key_key"
  ON "notifications"("dedupe_key");

CREATE INDEX "notifications_user_id_created_at_idx"
  ON "notifications"("user_id", "created_at" DESC);

-- A composite primary key makes adding an existing product idempotent and
-- prevents duplicate wishlist rows for the same account.
CREATE TABLE "wishlist_items" (
  "user_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "wishlist_items_pkey" PRIMARY KEY ("user_id", "product_id")
);

CREATE INDEX "wishlist_items_product_id_idx"
  ON "wishlist_items"("product_id");

ALTER TABLE "wishlist_items"
  ADD CONSTRAINT "wishlist_items_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "profiles"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "wishlist_items"
  ADD CONSTRAINT "wishlist_items_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Public application data is backend-only. Enable RLS for the exposed public
-- schema, but do not add browser policies; Prisma's owner connection and the
-- explicitly scoped server service role remain the only application writers.
ALTER TABLE public.wishlist_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.wishlist_items FROM PUBLIC;

DO $block$
DECLARE
  client_role text;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE public.wishlist_items FROM %I',
        client_role
      );
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL PRIVILEGES ON TABLE public.wishlist_items TO service_role;
  END IF;
END
$block$;

COMMIT;
