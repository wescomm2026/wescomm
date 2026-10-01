BEGIN;

CREATE TYPE "product_audience_scope" AS ENUM ('ALL_STUDENTS', 'SPECIFIC_DEPARTMENTS');

CREATE TABLE "departments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" TEXT NOT NULL,
  "group_name" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "departments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "departments_code_key" UNIQUE ("code")
);

INSERT INTO "departments" ("code", "group_name", "display_name", "sort_order") VALUES
  ('SHARE', 'Basic Education', 'SHARE', 10),
  ('CCD', 'Basic Education', 'Center for Child Development', 20),
  ('ELEM', 'Basic Education', 'Elementary', 30),
  ('HS', 'Basic Education', 'High School', 40),
  ('CAS', 'College', 'Arts and Sciences (CAS)', 100),
  ('CBA', 'College', 'College of Business and Accountancy (CBA)', 110),
  ('CCJE', 'College', 'Criminal Justice Education (CCJE)', 120),
  ('COED', 'College', 'Education (CoEd)', 130),
  ('CECT', 'College', 'Engineering and Computer Technology (CECT)', 140),
  ('CHTM', 'College', 'Hospitality and Tourism Management (CHTM)', 150),
  ('CON', 'College', 'College of Nursing (CON)', 160),
  ('CAMS', 'College', 'College of Allied Medical Sciences (CAMS)', 170),
  ('GRAD', 'Graduate / Professional', 'The Graduate School', 200),
  ('WDS', 'Graduate / Professional', 'Wesley Divinity School', 210),
  ('JWSLG', 'Graduate / Professional', 'John Wesley School of Law and Governance (JWSLG)', 220),
  ('MED', 'Graduate / Professional', 'Medicine', 230)
ON CONFLICT ("code") DO UPDATE SET
  "group_name" = EXCLUDED."group_name",
  "display_name" = EXCLUDED."display_name",
  "sort_order" = EXCLUDED."sort_order",
  "is_active" = true,
  "updated_at" = CURRENT_TIMESTAMP;

ALTER TABLE "profiles"
  ADD COLUMN "department_id" UUID,
  ADD COLUMN "onboarding_completed_at" TIMESTAMPTZ(6);

DO $$
BEGIN
  IF EXISTS (
    SELECT normalized_student_number
    FROM (
      SELECT upper(regexp_replace(trim("student_number"), '\s+', '', 'g')) AS normalized_student_number
      FROM "profiles"
      WHERE NULLIF(trim("student_number"), '') IS NOT NULL
    ) AS normalized
    GROUP BY normalized_student_number
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot normalize student numbers because normalized duplicates exist.';
  END IF;
END $$;

UPDATE "profiles"
SET "student_number" = NULLIF(upper(regexp_replace(trim("student_number"), '\s+', '', 'g')), '')
WHERE "student_number" IS NOT NULL;

UPDATE "profiles" AS profile
SET "department_id" = department."id"
FROM "departments" AS department
WHERE lower(trim(COALESCE(profile."department", ''))) IN (
  lower(department."code"),
  lower(department."display_name"),
  lower(regexp_replace(department."display_name", '\s*\([^)]*\)\s*$', ''))
);

UPDATE "profiles" AS profile
SET "department_id" = department."id"
FROM "departments" AS department
WHERE profile."department_id" IS NULL
  AND department."code" = CASE regexp_replace(lower(trim(COALESCE(profile."department", ''))), '[^a-z0-9]+', '', 'g')
    WHEN 'centerforchilddevelopment' THEN 'CCD'
    WHEN 'elementary' THEN 'ELEM'
    WHEN 'highschool' THEN 'HS'
    WHEN 'artsandsciences' THEN 'CAS'
    WHEN 'collegeofartsandsciences' THEN 'CAS'
    WHEN 'collegeofbusinessandaccountancy' THEN 'CBA'
    WHEN 'criminaljusticeeducation' THEN 'CCJE'
    WHEN 'collegeofcriminaljusticeeducation' THEN 'CCJE'
    WHEN 'education' THEN 'COED'
    WHEN 'collegeofeducation' THEN 'COED'
    WHEN 'engineeringandcomputertechnology' THEN 'CECT'
    WHEN 'collegeofengineeringandcomputertechnology' THEN 'CECT'
    WHEN 'hospitalityandtourismmanagement' THEN 'CHTM'
    WHEN 'collegeofhospitalityandtourismmanagement' THEN 'CHTM'
    WHEN 'nursing' THEN 'CON'
    WHEN 'collegeofnursing' THEN 'CON'
    WHEN 'alliedmedicalsciences' THEN 'CAMS'
    WHEN 'collegeofalliedmedicalsciences' THEN 'CAMS'
    WHEN 'graduateschool' THEN 'GRAD'
    WHEN 'thegraduateschool' THEN 'GRAD'
    WHEN 'wesleydivinityschool' THEN 'WDS'
    WHEN 'johnwesleyschooloflawandgovernance' THEN 'JWSLG'
    WHEN 'medicine' THEN 'MED'
    WHEN 'collegeofmedicine' THEN 'MED'
    ELSE NULL
  END;

UPDATE "profiles"
SET "onboarding_completed_at" = CURRENT_TIMESTAMP
WHERE "role" = 'STUDENT'
  AND "student_number" IS NOT NULL
  AND trim("student_number") <> ''
  AND "department_id" IS NOT NULL;

ALTER TABLE "products"
  ADD COLUMN "audience_scope" "product_audience_scope" NOT NULL DEFAULT 'ALL_STUDENTS';

CREATE TABLE "product_departments" (
  "product_id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_departments_pkey" PRIMARY KEY ("product_id", "department_id")
);

CREATE INDEX "profiles_department_id_idx" ON "profiles"("department_id");
CREATE INDEX "departments_is_active_sort_order_code_idx" ON "departments"("is_active", "sort_order", "code");
CREATE INDEX "product_departments_department_id_product_id_idx" ON "product_departments"("department_id", "product_id");

ALTER TABLE "profiles" ADD CONSTRAINT "profiles_department_id_fkey"
  FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_departments" ADD CONSTRAINT "product_departments_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_departments" ADD CONSTRAINT "product_departments_department_id_fkey"
  FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DO $block$
DECLARE
  client_role text;
BEGIN
  ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.product_departments ENABLE ROW LEVEL SECURITY;
  REVOKE ALL PRIVILEGES ON TABLE public.departments FROM PUBLIC;
  REVOKE ALL PRIVILEGES ON TABLE public.product_departments FROM PUBLIC;
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.departments FROM %I', client_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.product_departments FROM %I', client_role);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL PRIVILEGES ON TABLE public.departments TO service_role;
    GRANT ALL PRIVILEGES ON TABLE public.product_departments TO service_role;
  END IF;
END
$block$;

COMMIT;
