BEGIN;

CREATE TYPE "pickup_review_status" AS ENUM ('NONE', 'NEEDS_REVIEW', 'RESCHEDULED', 'WAIVED');

ALTER TABLE "products"
  ADD COLUMN "image_storage_path" TEXT;

ALTER TABLE "receipts"
  ADD COLUMN "public_verification_token_encrypted" TEXT,
  ADD COLUMN "public_verification_token_hash" CHAR(64),
  ADD COLUMN "verified_at" TIMESTAMPTZ(6),
  ADD COLUMN "voided_at" TIMESTAMPTZ(6);

UPDATE "receipts"
SET "verified_at" = "issued_at"
WHERE "status" = 'VERIFIED'::"receipt_status"
  AND "verified_at" IS NULL;

UPDATE "receipts"
SET "voided_at" = "updated_at"
WHERE "status" = 'VOIDED'::"receipt_status"
  AND "voided_at" IS NULL;

CREATE UNIQUE INDEX "receipts_public_verification_token_hash_key"
  ON "receipts"("public_verification_token_hash");
CREATE INDEX "receipts_status_verified_at_id_idx"
  ON "receipts"("status", "verified_at" DESC, "id" DESC);
CREATE INDEX "receipts_payment_method_status_verified_at_id_idx"
  ON "receipts"("payment_method", "status", "verified_at" DESC, "id" DESC);

CREATE TABLE "pickup_policy_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "version" INTEGER NOT NULL,
  "timezone" TEXT NOT NULL DEFAULT 'Asia/Manila',
  "min_advance_days" INTEGER NOT NULL,
  "max_advance_days" INTEGER NOT NULL,
  "effective_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "is_active" BOOLEAN NOT NULL DEFAULT false,
  "reason" TEXT NOT NULL,
  "created_by_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pickup_policy_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pickup_policy_versions_advance_days_check"
    CHECK ("min_advance_days" >= 0 AND "max_advance_days" >= "min_advance_days" AND "max_advance_days" <= 3650),
  CONSTRAINT "pickup_policy_versions_timezone_check"
    CHECK ("timezone" = 'Asia/Manila')
);

CREATE UNIQUE INDEX "pickup_policy_versions_version_key"
  ON "pickup_policy_versions"("version");
CREATE UNIQUE INDEX "pickup_policy_versions_one_active_idx"
  ON "pickup_policy_versions"("is_active")
  WHERE "is_active" = true;
CREATE INDEX "pickup_policy_versions_is_active_effective_at_idx"
  ON "pickup_policy_versions"("is_active", "effective_at" DESC);

CREATE TABLE "pickup_policy_days" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "policy_version_id" UUID NOT NULL,
  "weekday" INTEGER NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "pickup_policy_days_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pickup_policy_days_weekday_check" CHECK ("weekday" BETWEEN 0 AND 6)
);

CREATE UNIQUE INDEX "pickup_policy_days_policy_version_id_weekday_key"
  ON "pickup_policy_days"("policy_version_id", "weekday");

CREATE TABLE "pickup_time_slots" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "policy_version_id" UUID NOT NULL,
  "label" TEXT NOT NULL,
  "start_minute" INTEGER NOT NULL,
  "end_minute" INTEGER NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "pickup_time_slots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pickup_time_slots_minutes_check"
    CHECK ("start_minute" >= 0 AND "end_minute" <= 1440 AND "end_minute" > "start_minute")
);

CREATE UNIQUE INDEX "pickup_time_slots_policy_version_id_start_minute_end_minute_key"
  ON "pickup_time_slots"("policy_version_id", "start_minute", "end_minute");
CREATE INDEX "pickup_time_slots_policy_version_id_is_active_sort_order_idx"
  ON "pickup_time_slots"("policy_version_id", "is_active", "sort_order");

CREATE TABLE "pickup_closures" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "policy_version_id" UUID NOT NULL,
  "date" DATE NOT NULL,
  "reason" TEXT NOT NULL,
  CONSTRAINT "pickup_closures_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pickup_closures_policy_version_id_date_key"
  ON "pickup_closures"("policy_version_id", "date");
CREATE INDEX "pickup_closures_date_idx" ON "pickup_closures"("date");

INSERT INTO "pickup_policy_versions" (
  "version", "timezone", "min_advance_days", "max_advance_days", "is_active", "reason"
) VALUES (
  1, 'Asia/Manila', 1, 365, true, 'Initial version migrated from the legacy fixed pickup schedule.'
);

INSERT INTO "pickup_policy_days" ("policy_version_id", "weekday", "enabled")
SELECT policy."id", day."weekday", day."enabled"
FROM "pickup_policy_versions" policy
CROSS JOIN (VALUES
  (0, false), (1, true), (2, true), (3, true), (4, true), (5, true), (6, false)
) AS day("weekday", "enabled")
WHERE policy."version" = 1;

INSERT INTO "pickup_time_slots" (
  "policy_version_id", "label", "start_minute", "end_minute", "is_active", "sort_order"
)
SELECT policy."id", slot."label", slot."start_minute", slot."end_minute", true, slot."sort_order"
FROM "pickup_policy_versions" policy
CROSS JOIN (VALUES
  ('8:00 AM - 10:00 AM', 480, 600, 0),
  ('10:00 AM - 12:00 PM', 600, 720, 1),
  ('1:00 PM - 3:00 PM', 780, 900, 2),
  ('3:00 PM - 5:00 PM', 900, 1020, 3)
) AS slot("label", "start_minute", "end_minute", "sort_order")
WHERE policy."version" = 1;

ALTER TABLE "reservations"
  ADD COLUMN "pickup_policy_version_id" UUID,
  ADD COLUMN "pickup_time_slot_id" UUID,
  ADD COLUMN "pickup_review_status" "pickup_review_status" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "pickup_review_reason" TEXT,
  ADD COLUMN "schedule_revision" INTEGER NOT NULL DEFAULT 1;

UPDATE "reservations" reservation
SET "pickup_policy_version_id" = policy."id"
FROM "pickup_policy_versions" policy
WHERE policy."version" = 1;

UPDATE "reservations" reservation
SET "pickup_time_slot_id" = slot."id"
FROM "pickup_policy_versions" policy
INNER JOIN "pickup_time_slots" slot ON slot."policy_version_id" = policy."id"
WHERE policy."version" = 1
  AND reservation."pickup_start" IS NOT NULL
  AND reservation."pickup_end" IS NOT NULL
  AND (
    EXTRACT(HOUR FROM reservation."pickup_start" AT TIME ZONE 'Asia/Manila')::integer * 60
      + EXTRACT(MINUTE FROM reservation."pickup_start" AT TIME ZONE 'Asia/Manila')::integer
  ) = slot."start_minute"
  AND (
    EXTRACT(HOUR FROM reservation."pickup_end" AT TIME ZONE 'Asia/Manila')::integer * 60
      + EXTRACT(MINUTE FROM reservation."pickup_end" AT TIME ZONE 'Asia/Manila')::integer
  ) = slot."end_minute";

CREATE INDEX "reservations_pickup_review_status_pickup_start_id_idx"
  ON "reservations"("pickup_review_status", "pickup_start", "id");
CREATE INDEX "reservations_pickup_policy_version_id_idx"
  ON "reservations"("pickup_policy_version_id");
CREATE INDEX "reservations_pickup_time_slot_id_idx"
  ON "reservations"("pickup_time_slot_id");

CREATE TABLE "reservation_schedule_changes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "reservation_id" UUID NOT NULL,
  "actor_id" UUID,
  "reason" TEXT NOT NULL,
  "previous_pickup_start" TIMESTAMPTZ(6),
  "previous_pickup_end" TIMESTAMPTZ(6),
  "previous_policy_version" INTEGER,
  "previous_slot_label" TEXT,
  "new_pickup_start" TIMESTAMPTZ(6) NOT NULL,
  "new_pickup_end" TIMESTAMPTZ(6) NOT NULL,
  "new_policy_version" INTEGER NOT NULL,
  "new_slot_label" TEXT NOT NULL,
  "previous_schedule_revision" INTEGER NOT NULL,
  "new_schedule_revision" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reservation_schedule_changes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reservation_schedule_changes_revision_check"
    CHECK ("new_schedule_revision" = "previous_schedule_revision" + 1)
);

CREATE INDEX "reservation_schedule_changes_reservation_id_created_at_idx"
  ON "reservation_schedule_changes"("reservation_id", "created_at" DESC);
CREATE INDEX "reservation_schedule_changes_actor_id_created_at_idx"
  ON "reservation_schedule_changes"("actor_id", "created_at" DESC);

ALTER TABLE "pickup_policy_versions"
  ADD CONSTRAINT "pickup_policy_versions_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pickup_policy_days"
  ADD CONSTRAINT "pickup_policy_days_policy_version_id_fkey"
  FOREIGN KEY ("policy_version_id") REFERENCES "pickup_policy_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pickup_time_slots"
  ADD CONSTRAINT "pickup_time_slots_policy_version_id_fkey"
  FOREIGN KEY ("policy_version_id") REFERENCES "pickup_policy_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pickup_closures"
  ADD CONSTRAINT "pickup_closures_policy_version_id_fkey"
  FOREIGN KEY ("policy_version_id") REFERENCES "pickup_policy_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reservations"
  ADD CONSTRAINT "reservations_pickup_policy_version_id_fkey"
  FOREIGN KEY ("pickup_policy_version_id") REFERENCES "pickup_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "reservations_pickup_time_slot_id_fkey"
  FOREIGN KEY ("pickup_time_slot_id") REFERENCES "pickup_time_slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "reservations_schedule_revision_check" CHECK ("schedule_revision" > 0);
ALTER TABLE "reservation_schedule_changes"
  ADD CONSTRAINT "reservation_schedule_changes_reservation_id_fkey"
  FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "reservation_schedule_changes_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DO $block$
DECLARE
  client_role text;
  protected_table text;
BEGIN
  FOREACH protected_table IN ARRAY ARRAY[
    'pickup_policy_versions',
    'pickup_policy_days',
    'pickup_time_slots',
    'pickup_closures',
    'reservation_schedule_changes'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', protected_table);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC', protected_table);
    FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated']
    LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
        EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I', protected_table, client_role);
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT ALL PRIVILEGES ON TABLE public.%I TO service_role', protected_table);
    END IF;
  END LOOP;
END
$block$;

COMMIT;
