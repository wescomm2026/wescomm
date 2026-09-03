BEGIN;

ALTER TABLE "pickup_time_slots"
ADD COLUMN "capacity" INTEGER;

ALTER TABLE "pickup_time_slots"
ADD CONSTRAINT "pickup_time_slots_capacity_check"
CHECK ("capacity" IS NULL OR "capacity" > 0);

CREATE INDEX "reservations_pickup_start_pickup_end_status_idx"
ON "reservations"("pickup_start", "pickup_end", "status");

COMMIT;
