BEGIN;

CREATE TABLE "wesbot_ai_usage" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "model" TEXT NOT NULL,
  "operation" TEXT NOT NULL DEFAULT 'SEMANTIC_ROUTING',
  "status" TEXT NOT NULL,
  "error_code" TEXT,
  "input_tokens" INTEGER NOT NULL DEFAULT 0,
  "output_tokens" INTEGER NOT NULL DEFAULT 0,
  "total_tokens" INTEGER NOT NULL DEFAULT 0,
  "estimated_cost_usd" DECIMAL(14, 8) NOT NULL DEFAULT 0,
  "latency_ms" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wesbot_ai_usage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wesbot_ai_usage_token_counts_check" CHECK (
    "input_tokens" >= 0 AND "output_tokens" >= 0 AND "total_tokens" >= 0
  ),
  CONSTRAINT "wesbot_ai_usage_cost_check" CHECK ("estimated_cost_usd" >= 0),
  CONSTRAINT "wesbot_ai_usage_latency_check" CHECK ("latency_ms" >= 0)
);

CREATE INDEX "wesbot_ai_usage_created_at_idx"
  ON "wesbot_ai_usage"("created_at" DESC);
CREATE INDEX "wesbot_ai_usage_status_created_at_idx"
  ON "wesbot_ai_usage"("status", "created_at" DESC);
CREATE INDEX "wesbot_ai_usage_model_created_at_idx"
  ON "wesbot_ai_usage"("model", "created_at" DESC);

ALTER TABLE "wesbot_ai_usage" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "wesbot_ai_usage" FROM PUBLIC;

DO $block$
DECLARE
  client_role text;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE "wesbot_ai_usage" FROM %I', client_role);
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL PRIVILEGES ON TABLE "wesbot_ai_usage" TO service_role;
  END IF;
END
$block$;

COMMIT;
