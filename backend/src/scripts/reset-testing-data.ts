import "dotenv/config";

import { PrismaClient, ProductStatus } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import { databaseTargetFingerprint } from "../domain/payment-conversion-cli-policy.js";
import { assertSafeStagingMutationEnvironment } from "../domain/staging-data-policy.js";

const prisma = new PrismaClient();
const applyFlag = "--apply";
const deleteUsersFlag = "--delete-all-users";
const confirmationPrefix = "--confirm-reset-testing-data:";

function databaseLocation() {
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) throw new Error("DATABASE_URL is required.");
  const url = new URL(rawUrl);
  const database = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  return {
    host: url.hostname,
    database
  };
}

function supabaseLocation() {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!rawUrl || !serviceRoleKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to delete all users.");
  }
  const url = new URL(rawUrl);
  const projectRef = url.hostname.match(/^([a-z0-9]+)\.supabase\.co$/i)?.[1]?.toLowerCase() ?? null;
  if (!projectRef) throw new Error("The Supabase project reference could not be identified safely.");
  return { url: rawUrl, serviceRoleKey, projectRef };
}

function createSupabaseAdminClient(url: string, serviceRoleKey: string) {
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;

async function listAllAuthUsers(client: SupabaseAdminClient) {
  const users: Array<{ id: string }> = [];
  const perPage = 1_000;
  for (let page = 1; ; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    users.push(...data.users.map((user) => ({ id: user.id })));
    if (data.users.length < perPage) break;
  }
  return users;
}

async function currentCounts(authUserCount: number) {
  const [
    profiles,
    reservations,
    reservationBulkActions,
    receipts,
    walkInSales,
    walkInSaleItems,
    walkInSaleCostAllocations,
    payments,
    conversations,
    notifications,
    inventoryBatches,
    inventoryMovements,
    realtimeEvents,
    outboxEvents,
    authSessions,
    auditLogs
  ] = await Promise.all([
    prisma.profile.count(),
    prisma.reservation.count(),
    prisma.reservationBulkAction.count(),
    prisma.receipt.count(),
    prisma.walkInSale.count(),
    prisma.walkInSaleItem.count(),
    prisma.walkInSaleCostAllocation.count(),
    prisma.payment.count(),
    prisma.conversation.count(),
    prisma.notification.count(),
    prisma.inventoryBatch.count(),
    prisma.inventoryMovement.count(),
    prisma.realtimeEvent.count(),
    prisma.outboxEvent.count(),
    prisma.authSession.count(),
    prisma.auditLog.count()
  ]);
  return {
    authUsers: authUserCount,
    profiles,
    reservations,
    reservationBulkActions,
    receipts,
    walkInSales,
    walkInSaleItems,
    walkInSaleCostAllocations,
    payments,
    conversations,
    notifications,
    inventoryBatches,
    inventoryMovements,
    realtimeEvents,
    outboxEvents,
    authSessions,
    auditLogs
  };
}

async function main() {
  const target = assertSafeStagingMutationEnvironment(process.env);
  const location = databaseLocation();
  const supabase = supabaseLocation();
  const fingerprint = databaseTargetFingerprint(process.env.DATABASE_URL);
  const expectedConfirmation = `${confirmationPrefix}${fingerprint}`;
  const dryRun = !process.argv.includes(applyFlag);
  const deleteAllUsers = process.argv.includes(deleteUsersFlag);
  const confirmations = process.argv.filter((argument) => argument.startsWith(confirmationPrefix));
  const supabaseAdmin = createSupabaseAdminClient(supabase.url, supabase.serviceRoleKey);
  const authUsers = await listAllAuthUsers(supabaseAdmin);

  const preservedBefore = await Promise.all([
    prisma.department.count(),
    prisma.category.count(),
    prisma.product.count(),
    prisma.productVariant.count(),
    prisma.productSku.count(),
    prisma.faq.count(),
    prisma.appSetting.count(),
    prisma.pickupPolicyVersion.count()
  ]);
  const before = await currentCounts(authUsers.length);

  if (dryRun) {
    console.log(JSON.stringify({
      mode: "DRY_RUN",
      target: {
        environment: "staging",
        host: location.host,
        database: location.database,
        supabaseProjectRef: target.stagingProjectRef,
        fingerprint
      },
      wouldDelete: before,
      wouldPreserve: {
        departments: preservedBefore[0],
        categories: preservedBefore[1],
        products: preservedBefore[2],
        productVariants: preservedBefore[3],
        productSkus: preservedBefore[4],
        faqs: preservedBefore[5],
        appSettings: preservedBefore[6],
        pickupPolicies: preservedBefore[7]
      },
      applyCommand: `${applyFlag} ${deleteUsersFlag} ${expectedConfirmation}`
    }, null, 2));
    return;
  }

  if (!deleteAllUsers) {
    throw new Error(`Reset refused. Applying a complete reset requires ${deleteUsersFlag}.`);
  }
  if (confirmations.length !== 1 || confirmations[0] !== expectedConfirmation) {
    throw new Error(
      `Reset refused without exact database-target confirmation.\n`
      + `Database fingerprint: ${fingerprint}\n`
      + `Re-run with: ${applyFlag} ${deleteUsersFlag} ${expectedConfirmation}`
    );
  }

  const deleted = await prisma.$transaction(async (transaction) => {
    const counts: Record<string, number> = {};
    const remove = async (label: string, operation: Promise<{ count: number }>) => {
      counts[label] = (await operation).count;
    };

    await remove("orderItemCostAllocations", transaction.orderItemCostAllocation.deleteMany());
    await remove("walkInSaleCostAllocations", transaction.walkInSaleCostAllocation.deleteMany());
    await remove("walkInSaleItems", transaction.walkInSaleItem.deleteMany());
    await remove("walkInSales", transaction.walkInSale.deleteMany());
    await remove("payments", transaction.payment.deleteMany());
    await remove("receipts", transaction.receipt.deleteMany());
    await remove("paymongoWebhookEvents", transaction.paymongoWebhookEvent.deleteMany());
    await remove("onlinePaymentAttempts", transaction.onlinePaymentAttempt.deleteMany());
    await remove("onlinePayments", transaction.onlinePayment.deleteMany());
    await remove("reservationScheduleChanges", transaction.reservationScheduleChange.deleteMany());
    await remove("reservationIdempotencyKeys", transaction.reservationIdempotencyKey.deleteMany());
    await remove("reservationBulkActions", transaction.reservationBulkAction.deleteMany());
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
    await remove("authSessions", transaction.authSession.deleteMany());
    await remove("profiles", transaction.profile.deleteMany());

    counts.productSkusReset = (await transaction.productSku.updateMany({ data: { stock: 0, stockTarget: 0, lowStockThreshold: 0 } })).count;
    counts.productVariantsReset = (await transaction.productVariant.updateMany({ data: { stock: 0, stockTarget: 0, lowStockThreshold: 0 } })).count;
    counts.productsReset = (await transaction.product.updateMany({
      data: { stock: 0, stockTarget: 0, lowStockThreshold: 0, status: ProductStatus.OUT_OF_STOCK }
    })).count;

    return counts;
  }, { maxWait: 20_000, timeout: 120_000 });

  let deletedAuthUsers = 0;
  const authDeletionFailures: string[] = [];
  for (const user of authUsers) {
    const { error } = await supabaseAdmin.auth.admin.deleteUser(user.id, false);
    if (error) {
      authDeletionFailures.push(user.id);
      continue;
    }
    deletedAuthUsers += 1;
  }

  const remainingAuthUsers = await listAllAuthUsers(supabaseAdmin);

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
    reservationBulkActions: await prisma.reservationBulkAction.count(),
    receipts: await prisma.receipt.count(),
    payments: await prisma.payment.count(),
    walkInSales: await prisma.walkInSale.count(),
    walkInSaleItems: await prisma.walkInSaleItem.count(),
    walkInSaleCostAllocations: await prisma.walkInSaleCostAllocation.count(),
    inventoryBatches: await prisma.inventoryBatch.count(),
    inventoryMovements: await prisma.inventoryMovement.count(),
    notifications: await prisma.notification.count(),
    realtimeEvents: await prisma.realtimeEvent.count(),
    outboxEvents: await prisma.outboxEvent.count(),
    authSessions: await prisma.authSession.count(),
    conversations: await prisma.conversation.count(),
    auditLogs: await prisma.auditLog.count(),
    nonZeroProducts: await prisma.product.count({ where: { stock: { not: 0 } } }),
    nonZeroVariants: await prisma.productVariant.count({ where: { stock: { not: 0 } } }),
    nonZeroSkus: await prisma.productSku.count({ where: { stock: { not: 0 } } }),
    authUsers: remainingAuthUsers.length,
    authDeletionFailures: authDeletionFailures.length
  };

  const preservedLabels = ["departments", "categories", "products", "productVariants", "productSkus", "faqs", "appSettings", "pickupPolicies"];
  const preserved = Object.fromEntries(preservedLabels.map((label, index) => [label, preservedBefore[index]]));
  console.log(JSON.stringify({
    mode: "APPLIED",
    target: {
      environment: "staging",
      host: location.host,
      database: location.database,
      supabaseProjectRef: target.stagingProjectRef,
      fingerprint
    },
    preserved,
    deleted,
    deletedAuthUsers,
    verification
  }, null, 2));

  const expectedZeroChecks = [
    "profiles",
    "reservations",
    "reservationBulkActions",
    "receipts",
    "payments",
    "walkInSales",
    "walkInSaleItems",
    "walkInSaleCostAllocations",
    "inventoryBatches",
    "inventoryMovements",
    "notifications",
    "realtimeEvents",
    "outboxEvents",
    "authSessions",
    "conversations",
    "auditLogs",
    "nonZeroProducts",
    "nonZeroVariants",
    "nonZeroSkus",
    "authUsers"
  ] as const;
  const failedZeroChecks = expectedZeroChecks.filter((key) => verification[key] !== 0);
  if (failedZeroChecks.length) {
    throw new Error(`Reset verification failed for: ${failedZeroChecks.join(", ")}.`);
  }
  if (authDeletionFailures.length || remainingAuthUsers.length) {
    throw new Error("Application data was reset, but one or more Supabase Auth users could not be deleted. Re-run the same command safely.");
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
