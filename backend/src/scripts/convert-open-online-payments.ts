import "dotenv/config";

import {
  PAYMENT_CONVERSION_APPLY_FLAG,
  resolvePaymentConversionCliPolicy
} from "../domain/payment-conversion-cli-policy.js";
import {
  runOnlinePaymentCashConversion
} from "../services/online-payment-conversion.service.js";
import { runOutboxBatch } from "../services/outbox.service.js";

/**
 * Cash-only migration: audit open online payments and convert unpaid
 * checkouts to cash.
 *
 *   npx tsx src/scripts/convert-open-online-payments.ts --limit 100
 *     (dry run — reports what would be converted; allowed everywhere)
 *   npx tsx src/scripts/convert-open-online-payments.ts --apply --limit 100 --confirm-apply:<fingerprint>
 *     (converts only after confirming the exact DATABASE_URL target)
 *
 * The conversion is two-phase and race-safe: reservations stay online-paid
 * while any provider attempt is unresolved, and a late successful payment is
 * always preserved. Audit and notifications are delivered through the
 * transactional outbox, which this script drains after applying.
 */
function readLimit() {
  const index = process.argv.indexOf("--limit");
  if (index === -1) return 25;
  const value = Number(process.argv[index + 1]);
  return Number.isInteger(value) && value >= 1 && value <= 500 ? value : 25;
}

async function main() {
  const policy = resolvePaymentConversionCliPolicy({
    args: process.argv.slice(2),
    databaseUrl: process.env.DATABASE_URL
  });
  const { dryRun, fingerprint } = policy;

  const run = await runOnlinePaymentCashConversion({ limit: readLimit(), dryRun });

  if (!dryRun && run.converted > 0) {
    await runOutboxBatch({ limit: Math.min(run.converted, 50) });
  }

  console.log(JSON.stringify({
    databaseFingerprint: fingerprint,
    mode: dryRun ? "DRY_RUN" : "APPLIED",
    scanned: run.scanned,
    converted: run.converted,
    skipped: run.skipped,
    results: run.results
  }, null, 2));

  if (dryRun) {
    console.log(
      `\nDry run complete. Re-run with ${PAYMENT_CONVERSION_APPLY_FLAG} ${policy.expectedConfirmation} to convert the listed payments.`
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
