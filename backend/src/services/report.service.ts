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
    inventoryValue: string | number | null;
  };
  type SalesTrendRow = {
    key: string;
    sales: string | number;
    receipts: number;
  };
  type CategorySalesRow = {
    category: string;
    amount: string | number;
  };

  type ReportPayloadRow = {
    productMetrics: ProductMetricsRow;
    reservationGroups: Array<{ status: string; count: number }>;
    receiptAggregate: { totalAmount: string | number | null; count: number };
    pendingReceiptCount: number;
    userGroups: Array<{ role: string; count: number }>;
    activeConversations: number;
    salesTrendRows: SalesTrendRow[];
    categorySalesRows: CategorySalesRow[];
  };

  const rows = await withTransientPrismaReadRetry(() => prisma.$queryRaw<ReportPayloadRow[]>`
    SELECT
      (
        SELECT jsonb_build_object(
          'totalProducts', COUNT(*)::integer,
          'lowStockItems', COUNT(*) FILTER (WHERE stock <= low_stock_threshold)::integer,
          'outOfStockItems', COUNT(*) FILTER (WHERE stock <= 0)::integer,
          'inventoryValue', COALESCE(SUM(price * stock), 0)::text
        )
        FROM products
        WHERE is_active = true
      ) AS "productMetrics",
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object('status', grouped.status, 'count', grouped.count))
        FROM (
          SELECT status::text AS status, COUNT(*)::integer AS count
          FROM reservations
          GROUP BY status
        ) grouped
      ), '[]'::jsonb) AS "reservationGroups",
      (
        SELECT jsonb_build_object(
          'totalAmount', COALESCE(SUM(total_amount), 0)::text,
          'count', COUNT(*)::integer
        )
        FROM receipts
        WHERE status <> 'VOIDED'
      ) AS "receiptAggregate",
      (SELECT COUNT(*)::integer FROM receipts WHERE status = 'PENDING') AS "pendingReceiptCount",
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object('role', grouped.role, 'count', grouped.count))
        FROM (
          SELECT role::text AS role, COUNT(*)::integer AS count
          FROM profiles
          GROUP BY role
        ) grouped
      ), '[]'::jsonb) AS "userGroups",
      (SELECT COUNT(*)::integer FROM conversations WHERE status = 'OPEN') AS "activeConversations",
      COALESCE((
        SELECT jsonb_agg(to_jsonb(trend_row))
        FROM (
          SELECT
            TO_CHAR(issued_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD') AS key,
            COALESCE(SUM(total_amount), 0)::text AS sales,
            COUNT(*)::integer AS receipts
          FROM receipts
          WHERE status <> 'VOIDED'
            AND issued_at >= ${trendStart}
          GROUP BY TO_CHAR(issued_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD')
          ORDER BY key ASC
        ) trend_row
      ), '[]'::jsonb) AS "salesTrendRows",
      COALESCE((
        SELECT jsonb_agg(to_jsonb(category_row))
        FROM (
          SELECT
            categories.name AS category,
            COALESCE(SUM(reservation_items.subtotal), 0)::text AS amount
          FROM receipts
          INNER JOIN reservations ON reservations.id = receipts.reservation_id
          INNER JOIN reservation_items ON reservation_items.reservation_id = reservations.id
          INNER JOIN products ON products.id = reservation_items.product_id
          INNER JOIN categories ON categories.id = products.category_id
          WHERE receipts.status <> 'VOIDED'
            AND receipts.issued_at >= ${trendStart}
          GROUP BY categories.name
          ORDER BY SUM(reservation_items.subtotal) DESC
          LIMIT 6
        ) category_row
      ), '[]'::jsonb) AS "categorySalesRows"
  `);

  const payload = rows[0] ?? {
    productMetrics: { totalProducts: 0, lowStockItems: 0, outOfStockItems: 0, inventoryValue: 0 },
    reservationGroups: [],
    receiptAggregate: { totalAmount: 0, count: 0 },
    pendingReceiptCount: 0,
    userGroups: [],
    activeConversations: 0,
    salesTrendRows: [],
    categorySalesRows: []
  };
  const productMetricRows = [payload.productMetrics];
  const reservationGroups = payload.reservationGroups.map((group) => ({
    status: group.status,
    _count: { _all: group.count }
  }));
  const receiptAggregate = {
    _sum: { totalAmount: payload.receiptAggregate.totalAmount },
    _count: { _all: payload.receiptAggregate.count }
  };
  const pendingReceiptCount = payload.pendingReceiptCount;
  const userGroups = payload.userGroups.map((group) => ({
    role: group.role,
    _count: { _all: group.count }
  }));
  const activeConversations = payload.activeConversations;
  const salesTrendRows = payload.salesTrendRows;
  const categorySalesRows = payload.categorySalesRows;

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
  await Promise.all([
    reportRuntimeCache.delete(REPORT_CACHE_KEY),
    reportRuntimeCache.expireTag("reports")
  ]).catch(() => undefined);
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
