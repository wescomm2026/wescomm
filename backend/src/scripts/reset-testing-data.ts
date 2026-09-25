import "dotenv/config";

import { PrismaClient, ProductStatus } from "@prisma/client";

const prisma = new PrismaClient();
const confirmationFlag = "--confirm-reset-testing-data";
const remoteFlag = "--allow-remote-development-database";

function databaseLocation() {
  const rawUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!rawUrl) throw new Error("DIRECT_URL or DATABASE_URL is required.");
  const url = new URL(rawUrl);
  const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  return { host: url.hostname, database: url.pathname.slice(1), isLocal };
}

async function main() {
  if (!process.argv.includes(confirmationFlag)) {
    throw new Error(`Reset refused. Re-run with ${confirmationFlag}.`);
  }
  if (process.env.NODE_ENV === "production" || process.env.APP_ENV === "production") {
    throw new Error("Reset refused because the environment is marked as production.");
  }

  const location = databaseLocation();
  if (!location.isLocal && !process.argv.includes(remoteFlag)) {
    throw new Error(`Reset refused for a remote development database. Re-run with ${remoteFlag} after verifying the target.`);
  }

  const preservedBefore = await Promise.all([
    prisma.profile.count(),
    prisma.department.count(),
    prisma.category.count(),
    prisma.product.count(),
    prisma.productVariant.count(),
    prisma.productSku.count(),
    prisma.faq.count(),
    prisma.appSetting.count(),
    prisma.pickupPolicyVersion.count()
  ]);

  const deleted = await prisma.$transaction(async (transaction) => {
    const counts: Record<string, number> = {};
    const remove = async (label: string, operation: Promise<{ count: number }>) => {
      counts[label] = (await operation).count;
    };

    await remove("orderItemCostAllocations", transaction.orderItemCostAllocation.deleteMany());
    await remove("payments", transaction.payment.deleteMany());
    await remove("receipts", transaction.receipt.deleteMany());
    await remove("paymongoWebhookEvents", transaction.paymongoWebhookEvent.deleteMany());
    await remove("onlinePaymentAttempts", transaction.onlinePaymentAttempt.deleteMany());
    await remove("onlinePayments", transaction.onlinePayment.deleteMany());
    await remove("reservationScheduleChanges", transaction.reservationScheduleChange.deleteMany());
    await remove("reservationIdempotencyKeys", transaction.reservationIdempotencyKey.deleteMany());
    await remove("accountRestrictions", transaction.accountRestriction.deleteMany());
    await remove("studentOffenses", transaction.studentOffense.deleteMany());
    await remove("reservationItems", transaction.reservationItem.deleteMany());
    await remove("reservations", transaction.reservation.deleteMany());
    await remove("inventoryMovements", transaction.inventoryMovement.deleteMany());
    await remove("inventoryBatches", transaction.inventoryBatch.deleteMany());
    await remove("notifications", transaction.notification.deleteMany());
    await remove("realtimeEvents", transaction.realtimeEvent.deleteMany());
    await remove("outboxEvents", transaction.outboxEvent.deleteMany());
    await remove("auditLogs", transaction.auditLog.deleteMany());
    await remove("rateLimitCounters", transaction.rateLimitCounter.deleteMany());
    await remove("wishlistItems", transaction.wishlistItem.deleteMany());
    await remove("pushSubscriptions", transaction.pushSubscription.deleteMany());
    await remove("conversationMessageRevisions", transaction.conversationMessageRevision.deleteMany());
    await remove("conversationMessages", transaction.conversationMessage.deleteMany());
    await remove("conversations", transaction.conversation.deleteMany());
    await remove("conversationPurgeRecords", transaction.conversationPurgeRecord.deleteMany());
    await remove("wesbotAiUsage", transaction.wesbotAiUsage.deleteMany());
    await remove("policyAcceptances", transaction.policyAcceptance.deleteMany());

    counts.productSkusReset = (await transaction.productSku.updateMany({ data: { stock: 0 } })).count;
    counts.productVariantsReset = (await transaction.productVariant.updateMany({ data: { stock: 0 } })).count;
    counts.productsReset = (await transaction.product.updateMany({
      data: { stock: 0, status: ProductStatus.OUT_OF_STOCK }
    })).count;

    return counts;
  }, { maxWait: 20_000, timeout: 120_000 });

  const verification = {
    profiles: await prisma.profile.count(),
    departments: await prisma.department.count(),
    categories: await prisma.category.count(),
    products: await prisma.product.count(),
    productVariants: await prisma.productVariant.count(),
    productSkus: await prisma.productSku.count(),
    faqs: await prisma.faq.count(),
    appSettings: await prisma.appSetting.count(),
    pickupPolicies: await prisma.pickupPolicyVersion.count(),
    reservations: await prisma.reservation.count(),
    receipts: await prisma.receipt.count(),
    payments: await prisma.payment.count(),
    inventoryBatches: await prisma.inventoryBatch.count(),
    inventoryMovements: await prisma.inventoryMovement.count(),
    notifications: await prisma.notification.count(),
    conversations: await prisma.conversation.count(),
    auditLogs: await prisma.auditLog.count(),
    nonZeroProducts: await prisma.product.count({ where: { stock: { not: 0 } } }),
    nonZeroVariants: await prisma.productVariant.count({ where: { stock: { not: 0 } } }),
    nonZeroSkus: await prisma.productSku.count({ where: { stock: { not: 0 } } })
  };

  const preservedLabels = ["profiles", "departments", "categories", "products", "productVariants", "productSkus", "faqs", "appSettings", "pickupPolicies"];
  const preserved = Object.fromEntries(preservedLabels.map((label, index) => [label, preservedBefore[index]]));
  console.log(JSON.stringify({
    target: { hostType: location.isLocal ? "local" : "remote-development", database: location.database },
    preserved,
    deleted,
    verification
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
