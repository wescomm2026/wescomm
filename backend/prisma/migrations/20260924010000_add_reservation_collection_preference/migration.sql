ALTER TABLE "reservations"
  ADD COLUMN IF NOT EXISTS "preferred_collection_channel" "collection_channel" NOT NULL DEFAULT 'COMMISSARY';

COMMENT ON COLUMN "reservations"."preferred_collection_channel" IS
  'Student-selected collection location. The final audited channel remains payments.collection_channel.';
