import { prisma } from "../dist/lib/prisma.js";
import { backfillReceiptPublicVerificationTokens } from "../dist/services/receipt.service.js";

const BATCH_LIMIT = 50;

try {
  let updated = 0;
  let batches = 0;
  let result;

  do {
    result = await backfillReceiptPublicVerificationTokens({ limit: BATCH_LIMIT });
    updated += result.updated;
    batches += 1;
  } while (result.remainingPossible);

  console.log(JSON.stringify({ ok: true, updated, batches }, null, 2));
} finally {
  await prisma.$disconnect();
}
