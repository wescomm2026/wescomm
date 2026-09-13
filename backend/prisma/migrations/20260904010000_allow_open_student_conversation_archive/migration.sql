BEGIN;

-- A student's archive is a personal inbox preference and must not change or
-- depend on the support conversation lifecycle. Operational archive remains a
-- resolved-only state so retention and staff workflows keep their invariant.
ALTER TABLE "conversations"
  DROP CONSTRAINT "conversations_archive_requires_resolved_check";

ALTER TABLE "conversations"
  ADD CONSTRAINT "conversations_operations_archive_requires_resolved_check"
  CHECK (
    "operations_archived_at" IS NULL
    OR "status" = 'RESOLVED'::"conversation_status"
  ) NOT VALID;

ALTER TABLE "conversations"
  VALIDATE CONSTRAINT "conversations_operations_archive_requires_resolved_check";

COMMIT;
