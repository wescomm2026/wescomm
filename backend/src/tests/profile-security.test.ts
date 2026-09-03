import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { profileUpdateSchema } from "../domain/profile-update.js";

test("profile updates accept and normalize only mutable self-service fields", () => {
  assert.deepEqual(profileUpdateSchema.parse({
    fullName: "  Test Student  ",
    phone: " 09123456789 ",
    department: "   ",
    address: null
  }), {
    fullName: "Test Student",
    phone: "09123456789",
    department: null,
    address: null
  });
});

test("profile updates reject protected and storage-managed fields", () => {
  for (const protectedField of [
    "id",
    "email",
    "studentNumber",
    "role",
    "avatarUrl",
    "avatarDataUrl",
    "createdAt",
    "updatedAt"
  ]) {
    assert.equal(profileUpdateSchema.safeParse({ [protectedField]: "attacker-value" }).success, false);
  }
  assert.equal(profileUpdateSchema.safeParse({}).success, false);
  assert.equal(profileUpdateSchema.safeParse({ fullName: "   " }).success, false);
});

test("database migration makes public application data access backend-only", () => {
  const migrationPath = path.resolve(
    process.cwd(),
    "prisma/migrations/20260718120000_lock_down_direct_application_writes/migration.sql"
  );
  const sql = readFileSync(migrationPath, "utf8");
  const extensionHardeningPath = path.resolve(
    process.cwd(),
    "prisma/migrations/20260828010000_lock_down_trigram_function_privileges/migration.sql"
  );
  const extensionHardeningSql = readFileSync(extensionHardeningPath, "utf8");
  const baselineVerifier = readFileSync(
    path.resolve(process.cwd(), "scripts/verify-existing-database-baseline.mjs"),
    "utf8"
  );
  const migrationStatusVerifier = readFileSync(
    path.resolve(process.cwd(), "scripts/verify-prisma-migration-status.mjs"),
    "utf8"
  );
  const packageJson = JSON.parse(readFileSync(path.resolve(process.cwd(), "package.json"), "utf8"));

  assert.match(sql, /ARRAY\['anon', 'authenticated'\]/);
  assert.match(sql, /REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public/);
  assert.match(sql, /REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public/);
  assert.match(sql, /REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public/);
  assert.match(sql, /REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC/);
  assert.match(sql, /ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES/);
  assert.match(sql, /ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS/);
  assert.match(sql, /ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC/);
  assert.doesNotMatch(sql, /IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC/);
  assert.doesNotMatch(sql, /ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin/i);
  assert.match(sql, /GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role/);
  assert.match(sql, /GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role/);
  assert.match(sql, /ALTER TABLE public\._prisma_migrations ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(sql, /FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /ARRAY\['anon', 'authenticated', 'service_role'\]/);
  assert.match(sql, /REVOKE ALL PRIVILEGES ON TABLE public\._prisma_migrations FROM %I/);
  assert.match(sql, /DROP POLICY IF EXISTS "profiles_update_own"/);
  assert.match(sql, /DROP POLICY IF EXISTS "reservations_student_insert_own"/);
  assert.match(sql, /DROP POLICY IF EXISTS "reservation_items_student_insert_own"/);
  assert.match(sql, /UPDATE public\.auth_sessions\s+SET revoked_at = NOW\(\)/);
  assert.match(sql, /DROP POLICY IF EXISTS "avatars_user_upload_own" ON storage\.objects/);
  assert.match(sql, /DROP POLICY IF EXISTS "receipts_staff_upload" ON storage\.objects/);
  assert.match(sql, /DROP POLICY IF EXISTS "avatars_user_read_own" ON storage\.objects/);
  assert.match(sql, /DROP POLICY IF EXISTS "receipts_staff_read" ON storage\.objects/);
  assert.doesNotMatch(sql, /REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM service_role/i);
  assert.match(extensionHardeningSql, /ARRAY\['anon', 'authenticated'\]/);
  assert.match(extensionHardeningSql, /REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC/);
  assert.match(extensionHardeningSql, /ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC/);
  assert.match(extensionHardeningSql, /GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role/);
  assert.match(baselineVerifier, /dependency\.deptype = 'e'/);
  assert.match(baselineVerifier, /installed_extension\.extname = 'pg_trgm'/);
  assert.doesNotMatch(baselineVerifier, /installed_extension\.extname IN/);
  assert.match(baselineVerifier, /const columnRows = await prisma\.\$queryRaw/);
  assert.doesNotMatch(baselineVerifier, /Promise\.all/);
  assert.match(baselineVerifier, /DATABASE_VERIFICATION_MAX_ATTEMPTS = 3/);
  assert.match(baselineVerifier, /await waitForDatabaseConnection\(\)/);
  assert.match(migrationStatusVerifier, /PRISMA_STATUS_MAX_ATTEMPTS = 3/);
  assert.match(migrationStatusVerifier, /"migrate", "status"/);
  assert.match(migrationStatusVerifier, /Schema engine error:\\s\*\$/);
  assert.equal(
    packageJson.scripts["prisma:migrate:verify"],
    "node scripts/verify-existing-database-baseline.mjs --after-deploy && node scripts/verify-prisma-migration-status.mjs"
  );
});

test("Supabase bootstrap guides preserve the backend-only database boundary", () => {
  for (const fileName of ["SUPABASE_SQL_EDITOR_COMMANDS.txt", "BACKEND_DATABASE_API_SETUP.txt"]) {
    const sql = readFileSync(path.resolve(process.cwd(), "../txt_files", fileName), "utf8");
    assert.match(sql, /revoke all privileges on all tables in schema public from anon, authenticated/i);
    assert.match(sql, /revoke execute on all functions in schema public from public/i);
    assert.match(sql, /alter default privileges in schema public/i);
    assert.doesNotMatch(sql, /alter default privileges for role supabase_admin/i);
    assert.match(sql, /alter default privileges\s+revoke execute on functions from public/i);
    assert.doesNotMatch(sql, /in schema public\s+revoke execute on functions from public/i);
    assert.match(sql, /alter table public\._prisma_migrations enable row level security/i);
    assert.match(sql, /revoke all privileges on table public\._prisma_migrations from service_role/i);
    assert.doesNotMatch(sql, /force row level security/i);
    assert.match(sql, /drop policy if exists "avatars_user_read_own" on storage\.objects/i);
    assert.match(sql, /drop policy if exists "receipts_staff_read" on storage\.objects/i);
  }
});
