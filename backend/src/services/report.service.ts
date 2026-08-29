import { getCache } from "@vercel/functions";
import { resolveReportRange, type ReportRangeInput, type ResolvedReportRange } from "../domain/report-range.js";
import { prisma } from "../lib/prisma.js";
import { withTransientPrismaReadRetry } from "../utils/prisma-retry.js";

function toNumber(value: unknown) {
  const numericValue = Number(value ?? 0);
  return Number.isFinite(numericValue) ? numericValue : 0;
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

function trendLabel(key: string, granularity: ResolvedReportRange["granularity"]) {
  const value = granularity === "MONTHLY" ? `${key}-01T00:00:00+08:00` : `${key}T00:00:00+08:00`;
  return new Date(value).toLocaleDateString("en-PH", granularity === "MONTHLY"
    ? { month: "short", year: "numeric", timeZone: "Asia/Manila" }
    : { month: "short", day: "numeric", timeZone: "Asia/Manila" });
}

function nextTrendKey(key: string, granularity: ResolvedReportRange["granularity"]) {
  const value = new Date(`${granularity === "MONTHLY" ? `${key}-01` : key}T00:00:00Z`);
  if (granularity === "MONTHLY") value.setUTCMonth(value.getUTCMonth() + 1);
  else value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, granularity === "MONTHLY" ? 7 : 10);
}

function buildTrendRows(
  rows: Array<{ key: string; sales: string | number; receipts: number }>,
  range: ResolvedReportRange
) {
  const actual = new Map(rows.map((row) => [row.key, {
    key: row.key,
    day: trendLabel(row.key, range.granularity),
    sales: toNumber(row.sales),
    receipts: row.receipts
  }]));
  if (!range.from) return [...actual.values()];

  const first = range.granularity === "MONTHLY" ? range.from.slice(0, 7) : range.from;
  const last = range.granularity === "MONTHLY" ? range.to.slice(0, 7) : range.to;
  const result = [];
  for (let key = first; key <= last; key = nextTrendKey(key, range.granularity)) {
    result.push(actual.get(key) ?? {
      key,
      day: trendLabel(key, range.granularity),
      sales: 0,
      receipts: 0
    });
  }
  return result;
}

async function buildReportSummary(options: ReportRangeInput = {}) {
  const range = resolveReportRange(options);

  type ReportPayloadRow = {
    productMetrics: {
      totalProducts: number;
      lowStockItems: number;
      outOfStockItems: number;
      inventoryValue: string | number | null;
    };
    reservationGroups: Array<{ status: string; count: number }>;
    receiptAggregate: { totalAmount: string | number | null; count: number };
    receiptPaymentGroups: Array<{ channel: string; amount: string | number; count: number }>;
    pendingReceiptCount: number;
    userGroups: Array<{ role: string; count: number }>;
    activeConversations: number;
    salesTrendRows: Array<{ key: string; sales: string | number; receipts: number }>;
    categorySalesRows: Array<{ category: string; amount: string | number }>;
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
        WHERE status = 'VERIFIED'
          AND (${range.fromInclusive}::timestamptz IS NULL OR COALESCE(verified_at, issued_at) >= ${range.fromInclusive})
          AND COALESCE(verified_at, issued_at) < ${range.toExclusive}
      ) AS "receiptAggregate",
      COALESCE((
        SELECT jsonb_agg(to_jsonb(payment_row))
        FROM (
          SELECT
            CASE WHEN payment_method = 'PAYMONGO_GCASH' THEN 'ONLINE_GCASH' ELSE 'AT_COMMISSARY' END AS channel,
            COALESCE(SUM(total_amount), 0)::text AS amount,
            COUNT(*)::integer AS count
          FROM receipts
          WHERE status = 'VERIFIED'
            AND (${range.fromInclusive}::timestamptz IS NULL OR COALESCE(verified_at, issued_at) >= ${range.fromInclusive})
            AND COALESCE(verified_at, issued_at) < ${range.toExclusive}
          GROUP BY channel
          ORDER BY channel
        ) payment_row
      ), '[]'::jsonb) AS "receiptPaymentGroups",
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
            CASE WHEN ${range.granularity}::text = 'MONTHLY'
              THEN TO_CHAR(COALESCE(verified_at, issued_at) AT TIME ZONE 'Asia/Manila', 'YYYY-MM')
              ELSE TO_CHAR(COALESCE(verified_at, issued_at) AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD')
            END AS key,
            COALESCE(SUM(total_amount), 0)::text AS sales,
            COUNT(*)::integer AS receipts
          FROM receipts
          WHERE status = 'VERIFIED'
            AND (${range.fromInclusive}::timestamptz IS NULL OR COALESCE(verified_at, issued_at) >= ${range.fromInclusive})
            AND COALESCE(verified_at, issued_at) < ${range.toExclusive}
          GROUP BY key
          ORDER BY key ASC
        ) trend_row
      ), '[]'::jsonb) AS "salesTrendRows",
      COALESCE((
        SELECT jsonb_agg(to_jsonb(category_row))
        FROM (
          SELECT categories.name AS category, COALESCE(SUM(reservation_items.subtotal), 0)::text AS amount
          FROM receipts
          INNER JOIN reservations ON reservations.id = receipts.reservation_id
          INNER JOIN reservation_items ON reservation_items.reservation_id = reservations.id
          INNER JOIN products ON products.id = reservation_items.product_id
          INNER JOIN categories ON categories.id = products.category_id
          WHERE receipts.status = 'VERIFIED'
            AND (${range.fromInclusive}::timestamptz IS NULL OR COALESCE(receipts.verified_at, receipts.issued_at) >= ${range.fromInclusive})
            AND COALESCE(receipts.verified_at, receipts.issued_at) < ${range.toExclusive}
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
    receiptPaymentGroups: [],
    pendingReceiptCount: 0,
    userGroups: [],
    activeConversations: 0,
    salesTrendRows: [],
    categorySalesRows: []
  };
  const totalReservations = payload.reservationGroups.reduce((sum, group) => sum + group.count, 0);
  const roleCounts = Object.fromEntries(payload.userGroups.map((group) => [group.role, group.count]));
  const paymentCounts = Object.fromEntries(payload.receiptPaymentGroups.map((group) => [group.channel, group]));
  const lowStockItems = payload.productMetrics.lowStockItems ?? 0;
  const outOfStockItems = payload.productMetrics.outOfStockItems ?? 0;

  return {
    range: {
      preset: range.preset,
      from: range.from,
      to: range.to,
      granularity: range.granularity,
      label: range.label
    },
    totalSales: toNumber(payload.receiptAggregate.totalAmount),
    onlineGcashRevenue: toNumber(paymentCounts.ONLINE_GCASH?.amount),
    payAtCommissaryRevenue: toNumber(paymentCounts.AT_COMMISSARY?.amount),
    paymentMethodBreakdown: {
      onlineGcash: { amount: toNumber(paymentCounts.ONLINE_GCASH?.amount), receipts: paymentCounts.ONLINE_GCASH?.count ?? 0 },
      payAtCommissary: { amount: toNumber(paymentCounts.AT_COMMISSARY?.amount), receipts: paymentCounts.AT_COMMISSARY?.count ?? 0 }
    },
    totalReservations,
    pendingReservations: payload.reservationGroups.find((group) => group.status === "PENDING")?.count ?? 0,
    lowStockItems,
    outOfStockItems,
    totalProducts: payload.productMetrics.totalProducts ?? 0,
    inventoryValue: toNumber(payload.productMetrics.inventoryValue),
    activeUsers: payload.userGroups.reduce((sum, group) => sum + group.count, 0),
    roleCounts: { students: roleCounts.STUDENT ?? 0, staff: roleCounts.STAFF ?? 0, admins: roleCounts.ADMIN ?? 0 },
    receiptsToVerify: payload.pendingReceiptCount,
    totalReceipts: payload.receiptAggregate.count,
    activeConversations: payload.activeConversations,
    salesTrend: buildTrendRows(payload.salesTrendRows, range),
    categorySales: payload.categorySalesRows.map((row) => ({ category: row.category, amount: toNumber(row.amount) })),
    reservationStatusDistribution: payload.reservationGroups.map((group) => ({
      status: group.status,
      label: reservationStatusLabel(group.status),
      value: group.count,
      percent: totalReservations ? Math.round((group.count / totalReservations) * 1000) / 10 : 0
    })),
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
        insight: `${payload.activeConversations} open support conversations`,
        impact: payload.activeConversations ? "Medium" : "Positive",
        recommendation: payload.activeConversations ? "Assign staff replies" : "Support queue is clear"
      }
    ]
  };
}

const REPORT_CACHE_TTL_MS = 15_000;
const REPORT_CACHE_TTL_SECONDS = REPORT_CACHE_TTL_MS / 1_000;
type ReportSummary = Awaited<ReturnType<typeof buildReportSummary>>;

const cachedReports = new Map<string, { value: ReportSummary; expiresAt: number }>();
const pendingReports = new Map<string, Promise<ReportSummary>>();
const reportRuntimeCache = getCache({ namespace: "wescomm-reports" });

function isReportSummary(value: unknown): value is ReportSummary {
  return Boolean(value && typeof value === "object"
    && typeof (value as Partial<ReportSummary>).totalSales === "number"
    && Array.isArray((value as Partial<ReportSummary>).salesTrend));
}

export async function invalidateReportSummaryCache() {
  cachedReports.clear();
  await reportRuntimeCache.expireTag("reports").catch(() => undefined);
}

export async function getReportSummary(options: ReportRangeInput = {}) {
  const resolved = resolveReportRange(options);
  const key = `summary:v3:${resolved.cacheKey}`;
  const localValue = cachedReports.get(key);
  if (localValue && localValue.expiresAt > Date.now()) return localValue.value;
  const pendingValue = pendingReports.get(key);
  if (pendingValue) return pendingValue;

  const pending = (async () => {
    const regionalValue = await reportRuntimeCache.get(key).catch(() => null);
    if (isReportSummary(regionalValue)) {
      cachedReports.set(key, { value: regionalValue, expiresAt: Date.now() + REPORT_CACHE_TTL_MS });
      return regionalValue;
    }

    const value = await buildReportSummary(options);
    cachedReports.set(key, { value, expiresAt: Date.now() + REPORT_CACHE_TTL_MS });
    await reportRuntimeCache.set(key, value, {
      ttl: REPORT_CACHE_TTL_SECONDS,
      tags: ["reports"],
      name: "WESCOMM report summary"
    }).catch(() => undefined);
    return value;
  })().finally(() => pendingReports.delete(key));

  pendingReports.set(key, pending);
  return pending;
}
