BEGIN;

CREATE INDEX IF NOT EXISTS "profiles_role_full_name_email_id_idx"
ON "profiles"("role", "full_name", "email", "id");

CREATE INDEX IF NOT EXISTS "reservations_status_pickup_end_id_idx"
ON "reservations"("status", "pickup_end", "id");

COMMIT;
