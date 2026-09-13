BEGIN;

CREATE TYPE "pickup_advance_mode" AS ENUM ('OPEN_DAYS', 'CALENDAR_DAYS');

ALTER TABLE "pickup_policy_versions"
  ADD COLUMN "advance_mode" "pickup_advance_mode" NOT NULL DEFAULT 'OPEN_DAYS';

COMMENT ON COLUMN "pickup_policy_versions"."advance_mode" IS
  'Existing policies retain OPEN_DAYS semantics. Staff may activate a new CALENDAR_DAYS policy version explicitly.';

COMMIT;
