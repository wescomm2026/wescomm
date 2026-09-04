import { readFileSync } from "node:fs";
import path from "node:path";

const releaseMigrations = [
  {
    directory: "20260831000000_add_closure_qr_students_support_lifecycle",
    required: [
      /reservation_schedule_change_source/,
      /conversation_message_revisions/,
      /ENABLE ROW LEVEL SECURITY/
    ]
  },
  {
    directory: "20260901000000_add_pickup_slot_capacity",
    required: [
      /ADD COLUMN "capacity" INTEGER/,
      /CHECK \("capacity" IS NULL OR "capacity" > 0\)/,
      /reservations_pickup_start_pickup_end_status_idx/
    ]
  },
  {
    directory: "20260901010000_add_conversation_retention_purge",
    required: [
      /conversations_retention_state_check/,
      /conversation_purge_records/,
      /conversation_purge_records ENABLE ROW LEVEL SECURITY/,
      /REVOKE ALL PRIVILEGES ON TABLE public\.conversation_purge_records FROM PUBLIC/
    ]
  },
  {
    directory: "20260902000000_add_policy_acceptance",
    required: [
      /CREATE TABLE "policy_acceptances"/,
      /policy_acceptances_user_id_policy_version_key/,
      /reservations_checkout_policy_acceptance_check/,
      /policy_acceptances ENABLE ROW LEVEL SECURITY/,
      /REVOKE ALL PRIVILEGES ON TABLE public\.policy_acceptances FROM PUBLIC/
    ]
  },
  {
    directory: "20260904000000_restore_student_archived_support_on_reply",
    required: [
      /CREATE OR REPLACE FUNCTION public\.insert_active_wesbot_reply/,
      /CREATE OR REPLACE FUNCTION public\.insert_owned_staff_message/,
      /"student_archived_at" = NULL/,
      /SECURITY DEFINER/
    ]
  },
  {
    directory: "20260904010000_allow_open_student_conversation_archive",
    required: [
      /DROP CONSTRAINT "conversations_archive_requires_resolved_check"/,
      /ADD CONSTRAINT "conversations_operations_archive_requires_resolved_check"/,
      /CHECK \(\s*"operations_archived_at" IS NULL\s*OR "status" = 'RESOLVED'/,
      /VALIDATE CONSTRAINT "conversations_operations_archive_requires_resolved_check"/
    ]
  }
];

const forbiddenDestructiveStatements = [
  /\bDROP\s+(?:TABLE|COLUMN|TYPE|SCHEMA)\b/i,
  /\bTRUNCATE\b/i,
  /\bDELETE\s+FROM\b/i
];

const failures = [];
for (const migration of releaseMigrations) {
  const migrationPath = path.resolve(
    process.cwd(),
    "prisma",
    "migrations",
    migration.directory,
    "migration.sql"
  );
  let sql = "";
  try {
    sql = readFileSync(migrationPath, "utf8");
  } catch {
    failures.push(`${migration.directory}: migration.sql is missing.`);
    continue;
  }

  const normalized = sql.trim();
  if (!/^BEGIN;/i.test(normalized) || !/COMMIT;$/i.test(normalized)) {
    failures.push(`${migration.directory}: release migration must have explicit BEGIN/COMMIT boundaries.`);
  }
  for (const pattern of migration.required) {
    if (!pattern.test(sql)) failures.push(`${migration.directory}: missing required invariant ${pattern}.`);
  }
  for (const pattern of forbiddenDestructiveStatements) {
    if (pattern.test(sql)) failures.push(`${migration.directory}: destructive statement matched ${pattern}.`);
  }
}

if (failures.length) {
  console.error("Release migration preflight failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(JSON.stringify({
  status: "passed",
  migrations: releaseMigrations.map((migration) => migration.directory),
  guarantees: [
    "explicit-transaction-boundaries",
    "required-release-invariants",
    "no-destructive-ddl-or-data-deletion"
  ]
}, null, 2));
