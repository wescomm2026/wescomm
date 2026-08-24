-- Staff reservation and catalog search use case-insensitive contains filters.
-- B-tree indexes cannot serve ILIKE '%term%' predicates, so keep these GIN
-- trigram indexes in SQL alongside the other custom/partial indexes.
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

CREATE INDEX IF NOT EXISTS "reservations_reference_code_trgm_idx"
  ON "reservations" USING GIN ("reference_code" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "profiles_full_name_trgm_idx"
  ON "profiles" USING GIN ("full_name" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "profiles_email_trgm_idx"
  ON "profiles" USING GIN ("email" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "profiles_student_number_trgm_idx"
  ON "profiles" USING GIN ("student_number" gin_trgm_ops)
  WHERE "student_number" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "products_name_trgm_idx"
  ON "products" USING GIN ("name" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "products_description_trgm_idx"
  ON "products" USING GIN ("description" gin_trgm_ops)
  WHERE "description" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "categories_name_trgm_idx"
  ON "categories" USING GIN ("name" gin_trgm_ops);
