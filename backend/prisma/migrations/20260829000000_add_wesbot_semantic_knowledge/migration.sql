BEGIN;

ALTER TABLE "faqs"
  ADD COLUMN IF NOT EXISTS "source" TEXT,
  ADD COLUMN IF NOT EXISTS "source_version" TEXT;

CREATE TABLE IF NOT EXISTS "product_aliases" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "product_id" UUID NOT NULL,
  "alias" TEXT NOT NULL,
  "normalized_alias" TEXT NOT NULL,
  "source" TEXT,
  "source_version" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_aliases_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_aliases_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "product_aliases_product_id_normalized_alias_key"
  ON "product_aliases"("product_id", "normalized_alias");
CREATE INDEX IF NOT EXISTS "product_aliases_product_id_idx" ON "product_aliases"("product_id");
CREATE INDEX IF NOT EXISTS "product_aliases_normalized_alias_trgm_idx"
  ON "product_aliases" USING GIN ("normalized_alias" gin_trgm_ops);

CREATE TABLE IF NOT EXISTS "faq_variants" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "faq_id" UUID NOT NULL,
  "variant" TEXT NOT NULL,
  "normalized_text" TEXT NOT NULL,
  "source" TEXT,
  "source_version" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "faq_variants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "faq_variants_faq_id_fkey" FOREIGN KEY ("faq_id") REFERENCES "faqs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "faq_variants_faq_id_normalized_text_key"
  ON "faq_variants"("faq_id", "normalized_text");
CREATE INDEX IF NOT EXISTS "faq_variants_faq_id_idx" ON "faq_variants"("faq_id");
CREATE INDEX IF NOT EXISTS "faq_variants_normalized_text_trgm_idx"
  ON "faq_variants" USING GIN ("normalized_text" gin_trgm_ops);

ALTER TABLE "product_aliases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "faq_variants" ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE "product_aliases" FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE "faq_variants" FROM PUBLIC;

DO $block$
DECLARE
  client_role text;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE "product_aliases" FROM %I', client_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE "faq_variants" FROM %I', client_role);
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL PRIVILEGES ON TABLE "product_aliases" TO service_role;
    GRANT ALL PRIVILEGES ON TABLE "faq_variants" TO service_role;
  END IF;
END
$block$;

COMMIT;
