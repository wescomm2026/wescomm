import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const directUrl = process.env.DIRECT_URL?.trim();
if (!directUrl) {
  console.error("DIRECT_URL is required so verification and Prisma migrations target the same database.");
  process.exit(1);
}

const prisma = new PrismaClient({
  datasources: {
    db: { url: directUrl },
  },
});
const verifyAppliedMigration = process.argv.includes("--after-deploy");

const requiredColumns = {
  profiles: "id full_name email student_number phone department address role avatar_url created_at updated_at",
  auth_sessions: "id user_id token_hash user_agent expires_at last_seen_at revoked_at created_at",
  categories: "id name slug icon_url is_active created_at updated_at",
  products: "id category_id name description image_url price old_price status stock low_stock_threshold is_active created_at updated_at",
  product_variants: "id product_id option_name option_value stock created_at updated_at",
  inventory_movements: "id product_id variant_id type quantity previous_stock new_stock performed_by_id notes created_at",
  reservations: "id student_id reference_code status pickup_start pickup_end payment_method total_amount staff_notes created_at updated_at",
  reservation_idempotency_keys: "id student_id idempotency_key request_hash reservation_id expires_at created_at",
  student_offenses: "id student_id reservation_id type status reason occurred_at confirmed_by_id overturned_by_id overturned_at overturn_reason created_at",
  account_restrictions: "id student_id offense_id level source status reason starts_at ends_at created_by_id lifted_by_id lifted_at lift_reason created_at updated_at",
  reservation_items: "id reservation_id product_id variant_summary quantity unit_price subtotal created_at",
  receipts: "id receipt_code student_id reservation_id total_amount payment_method status verification_hash receipt_image_url receipt_pdf_url issued_by_id issued_at created_at updated_at",
  notifications: "id user_id title message type read_at created_at",
  push_subscriptions: "id user_id endpoint endpoint_hash p256dh auth user_agent created_at updated_at revoked_at",
  conversations: "id student_id assigned_staff_id subject status created_at updated_at",
  conversation_messages: "id conversation_id sender_id message created_at",
  faqs: "id question answer category is_published updated_by_id created_at updated_at",
  app_settings: "id key value updated_by_id created_at updated_at",
};

const requiredEnums = {
  app_role: "STUDENT STAFF ADMIN",
  product_status: "IN_STOCK RESTOCK_SOON OUT_OF_STOCK ON_SALE",
  inventory_movement_type: "RESTOCK SALE RESERVATION_HOLD RESERVATION_CANCEL RESERVATION_NO_SHOW ADJUSTMENT",
  reservation_status: "PENDING CONFIRMED READY_FOR_PICKUP COMPLETED CANCELLED NO_SHOW",
  student_offense_type: "NO_SHOW LATE_CANCELLATION RESERVATION_SPAM",
  student_offense_status: "ACTIVE OVERTURNED",
  restriction_status: "ACTIVE EXPIRED LIFTED",
  restriction_source: "AUTOMATIC MANUAL",
  payment_method: "PAY_AT_COMMISSARY E_WALLET_AT_PICKUP CASH GCASH",
  receipt_status: "PENDING VERIFIED VOIDED",
  notification_type: "RESERVATION RECEIPT LOW_STOCK MESSAGE SYSTEM",
  conversation_status: "OPEN RESOLVED",
};

function toSetMap(rows, groupKey, valueKey) {
  const result = new Map();
  for (const row of rows) {
    const values = result.get(row[groupKey]) ?? new Set();
    values.add(row[valueKey]);
    result.set(row[groupKey], values);
  }
  return result;
}

function collectMissing(actual, required) {
  const missing = [];
  for (const [group, values] of Object.entries(required)) {
    const actualValues = actual.get(group) ?? new Set();
    for (const value of values.split(" ")) {
      if (!actualValues.has(value)) {
        missing.push(`${group}.${value}`);
      }
    }
  }
  return missing;
}

try {
  const [columnRows, enumRows, indexRows, impactRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
    `,
    prisma.$queryRaw`
      SELECT type.typname AS enum_name, value.enumlabel AS enum_value
      FROM pg_type AS type
      JOIN pg_enum AS value ON value.enumtypid = type.oid
      JOIN pg_namespace AS namespace ON namespace.oid = type.typnamespace
      WHERE namespace.nspname = 'public'
    `,
    prisma.$queryRaw`
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'account_restrictions'
        AND indexname = 'account_restrictions_one_active_per_student_idx'
    `,
    prisma.$queryRaw`
      SELECT
        (
          SELECT COUNT(*)::integer
          FROM public.account_restrictions
          WHERE status = 'ACTIVE'
            AND ends_at IS NOT NULL
            AND ends_at <= NOW()
        ) AS stale_active_rows,
        (
          SELECT COALESCE(SUM(active_count - 1), 0)::integer
          FROM (
            SELECT COUNT(*) AS active_count
            FROM public.account_restrictions
            WHERE status = 'ACTIVE'
            GROUP BY student_id
            HAVING COUNT(*) > 1
          ) AS duplicate_groups
        ) AS duplicate_active_rows
    `,
  ]);

  const columns = toSetMap(columnRows, "table_name", "column_name");
  const enums = toSetMap(enumRows, "enum_name", "enum_value");
  const missingColumns = collectMissing(columns, requiredColumns);
  const missingEnums = collectMissing(enums, requiredEnums);

  if (missingColumns.length > 0 || missingEnums.length > 0) {
    console.error("Existing database does not match the Prisma baseline.");
    if (missingColumns.length > 0) {
      console.error(`Missing tables/columns: ${missingColumns.join(", ")}`);
    }
    if (missingEnums.length > 0) {
      console.error(`Missing enum values: ${missingEnums.join(", ")}`);
    }
    console.error("Run the required Supabase SQL bootstrap files before resolving 0_init.");
    process.exitCode = 1;
  } else {
    const indexDefinition = indexRows[0]?.indexdef ?? "";
    const hasExpectedIndex =
      /CREATE UNIQUE INDEX/i.test(indexDefinition) &&
      /\(student_id\)/i.test(indexDefinition.replaceAll('"', "")) &&
      /WHERE.*status.*ACTIVE/i.test(indexDefinition.replaceAll('"', ""));

    if (verifyAppliedMigration && !hasExpectedIndex) {
      console.error("The active-restriction unique index is missing or has the wrong definition.");
      process.exitCode = 1;
    } else if (!verifyAppliedMigration && indexRows.length > 0) {
      console.error("The active-restriction index already exists.");
      console.error("Do not deploy or resolve the pending migration until its existing SQL state is reconciled.");
      process.exitCode = 1;
    } else if (verifyAppliedMigration && impactRows[0].duplicate_active_rows > 0) {
      console.error("Duplicate ACTIVE restrictions remain after migration deployment.");
      process.exitCode = 1;
    } else {
      const phase = verifyAppliedMigration ? "Post-deploy verification" : "Existing-database baseline preflight";
      console.log(`${phase} passed.`);
      if (!verifyAppliedMigration) {
        console.log(
          `Pending migration impact: ${impactRows[0].stale_active_rows} stale ACTIVE row(s) will expire and ${impactRows[0].duplicate_active_rows} duplicate ACTIVE row(s) will be lifted.`,
        );
      }
    }
  }
} catch (error) {
  console.error("Could not verify the existing database baseline.");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
