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
const allowMissingSupabaseAuth = process.argv.includes("--allow-missing-supabase-auth");

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
  const [
    columnRows,
    enumRows,
    indexRows,
    impactRows,
    clientPrivilegeRows,
    defaultPrivilegeRows,
    authBoundaryRows,
  ] = await Promise.all([
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
    prisma.$queryRaw`
      WITH client_roles AS (
        SELECT rolname AS role_name
        FROM pg_roles
        WHERE rolname IN ('anon', 'authenticated')
      ),
      public_relations AS (
        SELECT class.relname AS object_name, class.relkind
        FROM pg_class AS class
        JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
        WHERE namespace.nspname = 'public'
          AND class.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
      ),
      table_privileges(privilege_type) AS (
        VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
      ),
      sequence_privileges(privilege_type) AS (
        VALUES ('SELECT'), ('UPDATE'), ('USAGE')
      ),
      relation_access AS (
        SELECT role.role_name, relation.object_name, privilege.privilege_type
        FROM client_roles AS role
        CROSS JOIN public_relations AS relation
        CROSS JOIN table_privileges AS privilege
        WHERE relation.relkind <> 'S'
          AND has_table_privilege(
            role.role_name,
            format('public.%I', relation.object_name),
            privilege.privilege_type
          )

        UNION ALL

        SELECT role.role_name, relation.object_name, privilege.privilege_type
        FROM client_roles AS role
        CROSS JOIN public_relations AS relation
        CROSS JOIN sequence_privileges AS privilege
        WHERE relation.relkind = 'S'
          AND has_sequence_privilege(
            role.role_name,
            format('public.%I', relation.object_name),
            privilege.privilege_type
          )
      ),
      function_access AS (
        SELECT role.role_name, routine.oid::regprocedure::text AS object_name, 'EXECUTE' AS privilege_type
        FROM client_roles AS role
        CROSS JOIN pg_proc AS routine
        JOIN pg_namespace AS namespace ON namespace.oid = routine.pronamespace
        WHERE namespace.nspname = 'public'
          AND has_function_privilege(role.role_name, routine.oid, 'EXECUTE')
      )
      SELECT role_name, object_name, privilege_type FROM relation_access
      UNION ALL
      SELECT role_name, object_name, privilege_type FROM function_access
      ORDER BY role_name, object_name, privilege_type
    `,
    prisma.$queryRaw`
      SELECT
        owner.rolname AS owner_role,
        COALESCE(grantee.rolname, 'PUBLIC') AS grantee_role,
        defaults.defaclobjtype AS object_type,
        privilege.privilege_type
      FROM pg_default_acl AS defaults
      JOIN pg_roles AS owner ON owner.oid = defaults.defaclrole
      JOIN pg_namespace AS namespace ON namespace.oid = defaults.defaclnamespace
      CROSS JOIN LATERAL aclexplode(defaults.defaclacl) AS privilege
      LEFT JOIN pg_roles AS grantee ON grantee.oid = privilege.grantee
      WHERE namespace.nspname = 'public'
        AND owner.rolname = current_user
        AND (privilege.grantee = 0 OR grantee.rolname IN ('anon', 'authenticated'))
        AND defaults.defaclobjtype IN ('r', 'S', 'f')
    `,
    prisma.$queryRaw`
      SELECT
        (
          SELECT COUNT(*)::integer
          FROM pg_policies
          WHERE schemaname = 'public'
            AND tablename = 'profiles'
            AND policyname = 'profiles_update_own'
        ) AS profile_update_policies,
        (
          SELECT COUNT(*)::integer
          FROM pg_class AS auth_table
          JOIN pg_namespace AS auth_schema ON auth_schema.oid = auth_table.relnamespace
          WHERE auth_schema.nspname = 'auth'
            AND auth_table.relname = 'users'
            AND auth_table.relkind IN ('r', 'p')
        ) AS auth_users_tables,
        (
          SELECT COUNT(*)::integer
          FROM pg_constraint AS constraint_record
          JOIN pg_class AS child_table ON child_table.oid = constraint_record.conrelid
          JOIN pg_namespace AS child_schema ON child_schema.oid = child_table.relnamespace
          WHERE constraint_record.contype = 'f'
            AND child_schema.nspname = 'public'
            AND child_table.relname = 'profiles'
            AND LOWER(REPLACE(pg_get_constraintdef(constraint_record.oid), '"', ''))
              LIKE '%foreign key (id) references auth.users(id)%on delete cascade%'
        ) AS auth_profile_foreign_keys,
        (
          SELECT COUNT(*)::integer
          FROM pg_trigger AS trigger_record
          JOIN pg_class AS source_table ON source_table.oid = trigger_record.tgrelid
          JOIN pg_namespace AS source_schema ON source_schema.oid = source_table.relnamespace
          JOIN pg_proc AS trigger_function ON trigger_function.oid = trigger_record.tgfoid
          JOIN pg_namespace AS function_schema ON function_schema.oid = trigger_function.pronamespace
          WHERE NOT trigger_record.tgisinternal
            AND trigger_record.tgenabled <> 'D'
            AND source_schema.nspname = 'auth'
            AND source_table.relname = 'users'
            AND function_schema.nspname = 'public'
            AND trigger_function.proname = 'handle_new_user'
        ) AS auth_profile_triggers,
        (
          SELECT COUNT(*)::integer
          FROM pg_class AS migration_table
          JOIN pg_namespace AS migration_schema ON migration_schema.oid = migration_table.relnamespace
          WHERE migration_schema.nspname = 'public'
            AND migration_table.relname = '_prisma_migrations'
            AND migration_table.relkind IN ('r', 'p')
            AND migration_table.relrowsecurity
            AND NOT migration_table.relforcerowsecurity
        ) AS migration_history_rls_tables,
        (
          SELECT COUNT(*)::integer
          FROM information_schema.table_privileges
          WHERE table_schema = 'public'
            AND table_name = '_prisma_migrations'
            AND grantee = 'service_role'
        ) AS service_role_migration_history_privileges,
        (
          SELECT COUNT(*)::integer
          FROM pg_roles AS migration_owner
          CROSS JOIN LATERAL aclexplode(
            COALESCE(
              (
                SELECT defaults.defaclacl
                FROM pg_default_acl AS defaults
                WHERE defaults.defaclrole = migration_owner.oid
                  AND defaults.defaclnamespace = 0
                  AND defaults.defaclobjtype = 'f'
              ),
              acldefault('f', migration_owner.oid)
            )
          ) AS privilege
          WHERE migration_owner.rolname = current_user
            AND privilege.grantee = 0
            AND privilege.privilege_type = 'EXECUTE'
        ) AS public_function_execute_defaults,
        (
          SELECT COUNT(*)::integer
          FROM pg_policies
          WHERE schemaname = 'storage'
            AND tablename = 'objects'
            AND policyname IN (
              'product_images_staff_upload',
              'product_images_staff_update',
              'avatars_user_read_own',
              'avatars_user_upload_own',
              'avatars_user_update_own',
              'receipts_staff_upload',
              'receipts_staff_read'
            )
        ) AS storage_write_policies
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
    const authBoundary = authBoundaryRows[0] ?? {};
    const hasExpectedIndex =
      /CREATE UNIQUE INDEX/i.test(indexDefinition) &&
      /\(student_id\)/i.test(indexDefinition.replaceAll('"', "")) &&
      /WHERE.*status.*ACTIVE/i.test(indexDefinition.replaceAll('"', ""));

    if (verifyAppliedMigration && clientPrivilegeRows.length > 0) {
      const sample = clientPrivilegeRows
        .slice(0, 10)
        .map((row) => `${row.role_name}:${row.object_name}:${row.privilege_type}`)
        .join(", ");
      console.error(`Client database privileges remain after migration: ${sample}`);
      process.exitCode = 1;
    } else if (verifyAppliedMigration && defaultPrivilegeRows.length > 0) {
      console.error("Dangerous anon/authenticated/PUBLIC defaults remain for the Prisma migration owner.");
      process.exitCode = 1;
    } else if (verifyAppliedMigration && authBoundary.public_function_execute_defaults > 0) {
      console.error("New functions created by the Prisma migration owner still grant EXECUTE to PUBLIC.");
      process.exitCode = 1;
    } else if (verifyAppliedMigration && authBoundary.profile_update_policies > 0) {
      console.error("The profiles_update_own policy still permits direct profile mutation.");
      process.exitCode = 1;
    } else if (verifyAppliedMigration && authBoundary.storage_write_policies > 0) {
      console.error("Direct authenticated private Storage policies remain after migration.");
      process.exitCode = 1;
    } else if (
      verifyAppliedMigration &&
      authBoundary.auth_users_tables !== 1 &&
      !allowMissingSupabaseAuth
    ) {
      console.error("Supabase auth.users is missing; its profile boundary cannot be verified.");
      process.exitCode = 1;
    } else if (
      verifyAppliedMigration &&
      authBoundary.auth_users_tables === 1 &&
      authBoundary.auth_profile_foreign_keys !== 1
    ) {
      console.error("profiles.id must reference auth.users.id with ON DELETE CASCADE.");
      process.exitCode = 1;
    } else if (
      verifyAppliedMigration &&
      authBoundary.auth_users_tables === 1 &&
      authBoundary.auth_profile_triggers !== 1
    ) {
      console.error("The enabled auth.users -> public.handle_new_user trigger is missing or duplicated.");
      process.exitCode = 1;
    } else if (verifyAppliedMigration && authBoundary.migration_history_rls_tables !== 1) {
      console.error("RLS must be enabled, but not forced, on public._prisma_migrations.");
      process.exitCode = 1;
    } else if (verifyAppliedMigration && authBoundary.service_role_migration_history_privileges > 0) {
      console.error("service_role must not have direct privileges on public._prisma_migrations.");
      process.exitCode = 1;
    } else if (verifyAppliedMigration && !hasExpectedIndex) {
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
      if (verifyAppliedMigration && authBoundary.auth_users_tables === 0 && allowMissingSupabaseAuth) {
        console.log("Supabase Auth boundary checks skipped because auth.users is absent in this plain PostgreSQL environment.");
      }
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
