BEGIN;

-- All application data access flows through the backend, where authorization,
-- validation, inventory transactions, rate limits, encryption, and audit logs
-- are enforced. Supabase Auth remains client-facing, but its anon/authenticated
-- database roles must not access public application objects directly.
DO $block$
DECLARE
  client_role text;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM %I',
      client_role
    );
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM %I',
      client_role
    );
    EXECUTE format(
      'REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM %I',
      client_role
    );

    -- Default privileges are scoped to the current Prisma migration owner.
    -- Supabase's platform-owned supabase_admin defaults cannot be changed by
    -- the project postgres role and do not own WESCOMM migration objects.
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES FROM %I',
      client_role
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON SEQUENCES FROM %I',
      client_role
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM %I',
      client_role
    );
  END LOOP;

  -- PostgreSQL grants function execution to PUBLIC by default, which would
  -- otherwise give anon/authenticated effective access through membership.
  REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC;
  REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
  REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

  ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC;
  -- PostgreSQL grants EXECUTE on new functions to PUBLIC globally by default;
  -- a schema-scoped REVOKE cannot undo that built-in global grant.
  ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

  -- The server-only Supabase client still needs access. Make that boundary
  -- explicit instead of relying on inherited or historical default grants.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;
    GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;
  END IF;
END
$block$;

-- Prisma's migration history is operational metadata, not application data.
-- Enabling (but not forcing) RLS satisfies the exposed-schema boundary while
-- preserving access for the table owner used by Prisma Migrate. No PostgREST
-- role needs direct access to this table.
DO $block$
DECLARE
  client_role text;
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    ALTER TABLE public._prisma_migrations ENABLE ROW LEVEL SECURITY;
    REVOKE ALL PRIVILEGES ON TABLE public._prisma_migrations FROM PUBLIC;

    FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
    LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
        EXECUTE format(
          'REVOKE ALL PRIVILEGES ON TABLE public._prisma_migrations FROM %I',
          client_role
        );
      END IF;
    END LOOP;
  END IF;
END
$block$;

-- Remove obsolete write policies so a later privilege change cannot silently
-- reopen direct writes. Read-only policies remain in place.
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_admin_update_all" ON public.profiles;
DROP POLICY IF EXISTS "categories_staff_manage" ON public.categories;
DROP POLICY IF EXISTS "products_staff_manage" ON public.products;
DROP POLICY IF EXISTS "product_variants_staff_manage" ON public.product_variants;
DROP POLICY IF EXISTS "inventory_movements_staff_insert" ON public.inventory_movements;
DROP POLICY IF EXISTS "reservations_student_insert_own" ON public.reservations;
DROP POLICY IF EXISTS "reservations_staff_update_all" ON public.reservations;
DROP POLICY IF EXISTS "reservation_items_student_insert_own" ON public.reservation_items;
DROP POLICY IF EXISTS "reservation_items_staff_manage" ON public.reservation_items;
DROP POLICY IF EXISTS "receipts_staff_manage" ON public.receipts;
DROP POLICY IF EXISTS "notifications_user_update_own" ON public.notifications;
DROP POLICY IF EXISTS "notifications_staff_insert" ON public.notifications;
DROP POLICY IF EXISTS "conversations_student_insert_own" ON public.conversations;
DROP POLICY IF EXISTS "conversations_staff_update_all" ON public.conversations;
DROP POLICY IF EXISTS "conversation_messages_insert_access" ON public.conversation_messages;
DROP POLICY IF EXISTS "faqs_staff_manage" ON public.faqs;
DROP POLICY IF EXISTS "app_settings_admin_manage" ON public.app_settings;

-- Cookie sessions issued before AMR enforcement cannot prove how the user
-- authenticated. Revoke them once so every browser must pass the new verified
-- passwordless bearer exchange before receiving a fresh application session.
UPDATE public.auth_sessions
SET revoked_at = NOW()
WHERE revoked_at IS NULL;

-- Private Storage access also passes through backend endpoints. Storage is not present
-- on plain PostgreSQL, so keep this migration portable with a conditional drop.
DO $block$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    DROP POLICY IF EXISTS "product_images_staff_upload" ON storage.objects;
    DROP POLICY IF EXISTS "product_images_staff_update" ON storage.objects;
    DROP POLICY IF EXISTS "avatars_user_read_own" ON storage.objects;
    DROP POLICY IF EXISTS "avatars_user_upload_own" ON storage.objects;
    DROP POLICY IF EXISTS "avatars_user_update_own" ON storage.objects;
    DROP POLICY IF EXISTS "receipts_staff_upload" ON storage.objects;
    DROP POLICY IF EXISTS "receipts_staff_read" ON storage.objects;
  END IF;
END
$block$;

COMMIT;
