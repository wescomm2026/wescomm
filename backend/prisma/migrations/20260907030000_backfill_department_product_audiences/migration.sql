BEGIN;

-- Backfill only products that have never been assigned an audience. This keeps
-- later Staff audience choices authoritative and makes the migration safe to
-- apply more than once.
CREATE TEMP TABLE "department_product_audience_backfill" (
  "product_id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  PRIMARY KEY ("product_id", "department_id")
) ON COMMIT DROP;

INSERT INTO "department_product_audience_backfill" ("product_id", "department_id")
SELECT product."id", department."id"
FROM (
  VALUES
    ('CBA Women''s Skirt', 'CBA'),
    ('CBA Women''s Uniform', 'CBA'),
    ('CBA Women''s Uniform Set', 'CBA'),
    ('Elementary PE Jogging Pants', 'ELEM'),
    ('Elementary PE Shirt', 'ELEM'),
    ('Elementary PE Uniform Set', 'ELEM'),
    ('Senior High Boys Polo', 'HS'),
    ('Senior High Boys Uniform Set', 'HS'),
    ('Senior High Girls Skirt', 'HS'),
    ('Senior High Girls Top', 'HS'),
    ('Senior High Girls Uniform Set', 'HS'),
    ('Senior High Men''s Pants', 'HS'),
    ('Drug Guide for Nurses and Clinicians', 'CON'),
    ('Fundamentals of Nursing Volume 1', 'CON'),
    ('Fundamentals of Nursing Volume 2', 'CON'),
    ('Kozier and Erb''s Nursing Methods Reference', 'CON'),
    ('Nursing Clinical Top', 'CON'),
    ('Nursing Men''s Uniform Set', 'CON'),
    ('Nursing Slacks', 'CON'),
    ('Nursing Smock Gown', 'CON'),
    ('Nursing Uniform Set', 'CON'),
    ('Nursing Women''s Uniform', 'CON'),
    ('Med Tech Uniform Pants', 'CAMS'),
    ('Med Tech Uniform Set', 'CAMS'),
    ('Med Tech Uniform Top', 'CAMS'),
    ('Principles of Medical Laboratory Science 1', 'CAMS'),
    ('WUP Criminology Uniform', 'CCJE')
) AS mapping("product_name", "department_code")
JOIN "products" AS product ON product."name" = mapping."product_name"
JOIN "departments" AS department ON department."code" = mapping."department_code"
WHERE product."audience_scope" = 'ALL_STUDENTS'
  AND NOT EXISTS (
    SELECT 1
    FROM "product_departments" AS existing
    WHERE existing."product_id" = product."id"
  );

INSERT INTO "product_departments" ("product_id", "department_id")
SELECT "product_id", "department_id"
FROM "department_product_audience_backfill"
ON CONFLICT ("product_id", "department_id") DO NOTHING;

UPDATE "products" AS product
SET "audience_scope" = 'SPECIFIC_DEPARTMENTS',
    "updated_at" = CURRENT_TIMESTAMP
WHERE product."id" IN (
  SELECT DISTINCT "product_id"
  FROM "department_product_audience_backfill"
);

-- Make all running backend instances observe the new catalog immediately.
INSERT INTO "app_settings" ("key", "value")
VALUES (
  'system.cache-revision.products',
  jsonb_build_object('revision', concat(floor(extract(epoch FROM clock_timestamp()) * 1000)::text, '-department-audience-backfill'))
)
ON CONFLICT ("key") DO UPDATE SET
  "value" = EXCLUDED."value",
  "updated_at" = CURRENT_TIMESTAMP;

COMMIT;
