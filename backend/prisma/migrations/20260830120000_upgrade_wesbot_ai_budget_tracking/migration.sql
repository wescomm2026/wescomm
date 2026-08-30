BEGIN;

ALTER TABLE "wesbot_ai_usage"
  ADD COLUMN "cached_input_tokens" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "reasoning_output_tokens" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "reserved_cost_usd" DECIMAL(14, 8) NOT NULL DEFAULT 0,
  ADD COLUMN "input_rate_usd_per_1m_tokens" DECIMAL(14, 8) NOT NULL DEFAULT 0,
  ADD COLUMN "cached_rate_usd_per_1m_tokens" DECIMAL(14, 8) NOT NULL DEFAULT 0,
  ADD COLUMN "output_rate_usd_per_1m_tokens" DECIMAL(14, 8) NOT NULL DEFAULT 0,
  ADD COLUMN "pricing_version" TEXT NOT NULL DEFAULT 'unspecified',
  ADD COLUMN "completed_at" TIMESTAMPTZ(6);

ALTER TABLE "wesbot_ai_usage"
  DROP CONSTRAINT "wesbot_ai_usage_token_counts_check",
  DROP CONSTRAINT "wesbot_ai_usage_cost_check";

ALTER TABLE "wesbot_ai_usage"
  ADD CONSTRAINT "wesbot_ai_usage_token_counts_check" CHECK (
    "input_tokens" >= 0
    AND "cached_input_tokens" >= 0
    AND "output_tokens" >= 0
    AND "reasoning_output_tokens" >= 0
    AND "total_tokens" >= 0
  ),
  ADD CONSTRAINT "wesbot_ai_usage_cost_check" CHECK (
    "estimated_cost_usd" >= 0
    AND "reserved_cost_usd" >= 0
    AND "input_rate_usd_per_1m_tokens" >= 0
    AND "cached_rate_usd_per_1m_tokens" >= 0
    AND "output_rate_usd_per_1m_tokens" >= 0
  );

CREATE INDEX "wesbot_ai_usage_operation_created_at_idx"
  ON "wesbot_ai_usage"("operation", "created_at" DESC);

CREATE INDEX "wesbot_ai_usage_status_completed_at_idx"
  ON "wesbot_ai_usage"("status", "completed_at" DESC);

COMMIT;
