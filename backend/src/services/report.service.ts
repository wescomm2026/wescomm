import { Prisma } from "@prisma/client";
import { getCache } from "@vercel/functions";
import { prisma } from "../lib/prisma.js";
import { withTransientPrismaReadRetry } from "../utils/prisma-retry.js";

function toNumber(value: unknown) {
  const numericValue = Number(value ?? 0);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function subDays(value: Date, days: number) {
  const date = new Date(value);
  date.setDate(date.getDate() - days);
  return date;
}

function dayKey(value: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Manila"
  }).format(value);
}

function formatTrendLabel(value: Date) {
  return value.toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    timeZone: "Asia/Manila"
  });
}

function reservationStatusLabel(status: string) {
  const labels: Record<string, string> = {
    PENDING: "Pending",
    CONFIRMED: "Confirmed",
    READY_FOR_PICKUP: "Ready for Pick-up",
    COMPLETED: "Completed",
    CANCELLED: "Cancelled"
  };

  return labels[status] ?? status;
}

async function buildReportSummary() {
  const today = new Date();
  const trendStart = subDays(today, 6);

  type ProductMetricsRow = {
    totalProducts: number;
    lowStockItems: number;
    outOfStockItems: number;
    inventoryValue: Prisma.Decimal | string | number | null;
  };
  type SalesTrendRow = {
    key: string;
    sales: Prisma.Decimal | string | number;
    receipts: number;
  };
  type CategorySalesRow = {
    category: string;
    amount: Prisma.Decimal | string | number;
  };

  const [
    productMetricRows,
    reservationGroups,
    receiptAggregate,
    pendingReceiptCount,
    userGroups,
    activeConversations,
    salesTrendRows,
    categorySalesRows
  ] = await withTransientPrismaReadRetry(() => prisma.$transaction([
    prisma.$queryRaw<ProductMetricsRow[]>`
      SELECT
        COUNT(*)::integer AS "totalProducts",
        COUNT(*) FILTER (WHERE "stock" <= "low_stock_threshold")::integer AS "lowStockItems",
        COUNT(*) FILTER (WHERE "stock" <= 0)::integer AS "outOfStockItems",
        COALESCE(SUM("price" * "stock"), 0) AS "inventoryValue"
      FROM "products"
      WHERE "is_active" = TRUE
    `,
    prisma.reservation.groupBy({
      by: ["status"],
      _count: { _all: true }
    }),
    prisma.receipt.aggregate({
      where: { status: { not: "VOIDED" } },
      _sum: { totalAmount: true },
      _count: { _all: true }
    }),
    prisma.receipt.count({ where: { status: "PENDING" } }),
    prisma.profile.groupBy({
      by: ["role"],
      _count: { _all: true }
    }),
    prisma.conversation.count({ where: { status: "OPEN" } }),
    prisma.$queryRaw<SalesTrendRow[]>`
      SELECT
        TO_CHAR("issued_at" AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD') AS "key",
        COALESCE(SUM("total_amount"), 0) AS "sales",
        COUNT(*)::integer AS "receipts"
      FROM "receipts"
      WHERE "status" <> 'VOIDED'::"receipt_status"
        AND "issued_at" >= ${trendStart}
      GROUP BY TO_CHAR("issued_at" AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD')
      ORDER BY "key" ASC
    `,
    prisma.$queryRaw<CategorySalesRow[]>`
      SELECT
        "categories"."name" AS "category",
        COALESCE(SUM("reservation_items"."subtotal"), 0) AS "amount"
      FROM "receipts"
      INNER JOIN "reservations"
        ON "reservations"."id" = "receipts"."reservation_id"
      INNER JOIN "reservation_items"
        ON "reservation_items"."reservation_id" = "reservations"."id"
      INNER JOIN "products"
        ON "products"."id" = "reservation_items"."product_id"
      INNER JOIN "categories"
        ON "categories"."id" = "products"."category_id"
      WHERE "receipts"."status" <> 'VOIDED'::"receipt_status"
        AND "receipts"."issued_at" >= ${trendStart}
      GROUP BY "categories"."name"
      ORDER BY "amount" DESC
      LIMIT 6
    `
  ]));

  const productMetrics = productMetricRows[0];
  const totalProducts = productMetrics?.totalProducts ?? 0;
  const lowStockItems = productMetrics?.lowStockItems ?? 0;
  const outOfStockItems = productMetrics?.outOfStockItems ?? 0;
  const inventoryValue = toNumber(productMetrics?.inventoryValue);
  const totalReservations = reservationGroups.reduce((sum, group) => sum + group._count._all, 0);
  const pendingReservations = reservationGroups.find((group) => group.status === "PENDING")?._count._all ?? 0;
  const activeUsers = userGroups.reduce((sum, group) => sum + group._count._all, 0);
  const totalSales = toNumber(receiptAggregate._sum.totalAmount);
  const totalReceipts = receiptAggregate._count._all;

  const roleCounts = Object.fromEntries(userGroups.map((group) => [group.role, group._count._all]));
  const reservationStatusDistribution = reservationGroups.map((group) => ({
    status: group.status,
    label: reservationStatusLabel(group.status),
    value: group._count._all,
    percent: totalReservations ? Math.round((group._count._all / totalReservations) * 1000) / 10 : 0
  }));

  const trendDays = Array.from({ length: 7 }, (_, index) => {
    const date = subDays(today, 6 - index);
    return {
      key: dayKey(date),
      day: formatTrendLabel(date),
      sales: 0,
      receipts: 0
    };
  });

  const trendByDay = new Map(trendDays.map((day) => [day.key, day]));
  salesTrendRows.forEach((row) => {
    const trend = trendByDay.get(row.key);
    if (trend) {
      trend.sales = toNumber(row.sales);
      trend.receipts = row.receipts;
    }
  });

  return {
    totalSales,
    totalReservations,
    pendingReservations,
    lowStockItems,
    outOfStockItems,
    totalProducts,
    inventoryValue,
    activeUsers,
    roleCounts: {
      students: roleCounts.STUDENT ?? 0,
      staff: roleCounts.STAFF ?? 0,
      admins: roleCounts.ADMIN ?? 0
    },
    receiptsToVerify: pendingReceiptCount,
    totalReceipts,
    activeConversations,
    salesTrend: trendDays,
    categorySales: categorySalesRows.map((row) => ({ category: row.category, amount: toNumber(row.amount) })),
    reservationStatusDistribution,
    inventoryInsights: [
      {
        insight: `${lowStockItems} items reached restock alert count`,
        impact: lowStockItems ? "High" : "Positive",
        recommendation: lowStockItems ? "Review restock priorities" : "Maintain current stock planning"
      },
      {
        insight: `${outOfStockItems} out-of-stock items`,
        impact: outOfStockItems ? "High" : "Positive",
        recommendation: outOfStockItems ? "Coordinate immediate replenishment" : "No unavailable items at the moment"
      },
      {
        insight: `${activeConversations} open support conversations`,
        impact: activeConversations ? "Medium" : "Positive",
        recommendation: activeConversations ? "Assign staff replies" : "Support queue is clear"
      }
    ]
  };
}

const REPORT_CACHE_TTL_MS = 15_000;
const REPORT_CACHE_TTL_SECONDS = REPORT_CACHE_TTL_MS / 1_000;
const REPORT_CACHE_KEY = "summary:v2";
type ReportSummary = Awaited<ReturnType<typeof buildReportSummary>>;

let cachedReport: { value: ReportSummary; expiresAt: number } | null = null;
let pendingReport: Promise<ReportSummary> | null = null;
const reportRuntimeCache = getCache({ namespace: "wescomm-reports" });

function isReportSummary(value: unknown): value is ReportSummary {
  return Boolean(
    value
    && typeof value === "object"
    && typeof (value as Partial<ReportSummary>).totalSales === "number"
    && Array.isArray((value as Partial<ReportSummary>).salesTrend)
  );
}

export async function invalidateReportSummaryCache() {
  cachedReport = null;
  await reportRuntimeCache.delete(REPORT_CACHE_KEY).catch(() => undefined);
}

export async function getReportSummary() {
  if (cachedReport && cachedReport.expiresAt > Date.now()) return cachedReport.value;
  if (pendingReport) return pendingReport;

  pendingReport = (async () => {
    const regionalValue = await reportRuntimeCache.get(REPORT_CACHE_KEY).catch(() => null);
    if (isReportSummary(regionalValue)) {
      cachedReport = { value: regionalValue, expiresAt: Date.now() + REPORT_CACHE_TTL_MS };
      return regionalValue;
    }

    const value = await buildReportSummary();
    cachedReport = { value, expiresAt: Date.now() + REPORT_CACHE_TTL_MS };
    await reportRuntimeCache.set(REPORT_CACHE_KEY, value, {
      ttl: REPORT_CACHE_TTL_SECONDS,
      tags: ["reports"],
      name: "WESCOMM report summary"
    }).catch(() => undefined);
    return value;
  })()
    .finally(() => {
      pendingReport = null;
    });

  return pendingReport;
}
