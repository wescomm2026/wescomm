import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const releaseMigrationFloor = "20260831000000_add_closure_qr_students_support_lifecycle";

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
  },
  {
    directory: "20260907000000_add_reservation_item_snapshots",
    required: [
      /ADD COLUMN "product_name_snapshot" TEXT/,
      /ADD COLUMN "sku_code_snapshot" TEXT/,
      /ADD COLUMN "option_snapshot" JSONB NOT NULL/,
      /ALTER COLUMN "product_name_snapshot" SET NOT NULL/
    ]
  },
  {
    directory: "20260907010000_add_departments_and_product_audiences",
    required: [
      /CREATE TABLE "departments"/,
      /CREATE TABLE "product_departments"/,
      /normalized duplicates exist/,
      /departments ENABLE ROW LEVEL SECURITY/,
      /product_departments ENABLE ROW LEVEL SECURITY/,
      /REVOKE ALL PRIVILEGES ON TABLE public\.departments FROM PUBLIC/
    ]
  },
  {
    directory: "20260907020000_add_pickup_advance_mode",
    required: [
      /CREATE TYPE "pickup_advance_mode"/,
      /ADD COLUMN "advance_mode" "pickup_advance_mode" NOT NULL DEFAULT 'OPEN_DAYS'/
    ]
  },
  {
    directory: "20260907030000_backfill_department_product_audiences",
    required: [
      /CREATE TEMP TABLE "department_product_audience_backfill"/,
      /product\."audience_scope" = 'ALL_STUDENTS'/,
      /NOT EXISTS[\s\S]*FROM "product_departments" AS existing/,
      /SET "audience_scope" = 'SPECIFIC_DEPARTMENTS'/,
      /system\.cache-revision\.products/
    ]
  },
  {
    directory: "20260924000000_add_fifo_costing_and_collection_channels",
    required: [
      /CREATE TYPE "collection_channel" AS ENUM \('COMMISSARY', 'TREASURER'\)/,
      /CREATE TABLE IF NOT EXISTS "inventory_batches"/,
      /CREATE TABLE IF NOT EXISTS "order_item_cost_allocations"/,
      /CREATE TABLE IF NOT EXISTS "payments"/,
      /payments_treasurer_or_required/,
      /"inventory_batches" ENABLE ROW LEVEL SECURITY/,
      /"order_item_cost_allocations" ENABLE ROW LEVEL SECURITY/,
      /"payments" ENABLE ROW LEVEL SECURITY/
    ]
  },
  {
    directory: "20260924010000_add_reservation_collection_preference",
    requiresExplicitTransaction: false,
    nonTransactionalReason: "Already applied as an idempotent ALTER TABLE plus COMMENT; preserve its Prisma checksum.",
    required: [
      /ADD COLUMN IF NOT EXISTS "preferred_collection_channel" "collection_channel" NOT NULL DEFAULT 'COMMISSARY'/,
      /final audited channel remains payments\.collection_channel/
    ]
  }
];

const forbiddenDestructiveStatements = [
  /\bDROP\s+(?:TABLE|COLUMN|TYPE|SCHEMA)\b/i,
  /\bTRUNCATE\b/i,
  /\bDELETE\s+FROM\b/i
];

const failures = [];
const migrationsRoot = path.resolve(process.cwd(), "prisma", "migrations");
const configuredReleaseMigrations = new Set(releaseMigrations.map((migration) => migration.directory));
const discoveredReleaseMigrations = readdirSync(migrationsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name >= releaseMigrationFloor)
  .map((entry) => entry.name)
  .sort();

for (const directory of discoveredReleaseMigrations) {
  if (!configuredReleaseMigrations.has(directory)) {
    failures.push(`${directory}: release migration is not registered in verify-release-migrations.mjs.`);
  }
}

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
  const requiresExplicitTransaction = migration.requiresExplicitTransaction !== false;
  if (requiresExplicitTransaction && (!/^BEGIN;/i.test(normalized) || !/COMMIT;$/i.test(normalized))) {
    failures.push(`${migration.directory}: release migration must have explicit BEGIN/COMMIT boundaries.`);
  }
  if (!requiresExplicitTransaction && !migration.nonTransactionalReason?.trim()) {
    failures.push(`${migration.directory}: a reviewed non-transactional migration requires a documented reason.`);
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
    "all-release-migrations-registered",
    "explicit-transaction-boundaries-or-reviewed-checksum-preserving-exception",
    "required-release-invariants",
    "no-destructive-ddl-or-data-deletion"
  ],
  reviewedNonTransactionalMigrations: releaseMigrations
    .filter((migration) => migration.requiresExplicitTransaction === false)
    .map((migration) => ({
      directory: migration.directory,
      reason: migration.nonTransactionalReason
    }))
}, null, 2));
