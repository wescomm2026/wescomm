import { Prisma } from "@prisma/client";
import { getCache } from "@vercel/functions";
import { bumpCacheRevision, readCacheRevision } from "./cache-revision.service.js";
import { resolveReportRange, type ReportRangeInput, type ResolvedReportRange } from "../domain/report-range.js";
import { prisma } from "../lib/prisma.js";
import { withTransientPrismaReadRetry } from "../utils/prisma-retry.js";
import type { CollectionChannel } from "../types/app.js";

export type FinancialReportInput = ReportRangeInput & {
  collectionChannel?: CollectionChannel;
  categoryId?: string;
};

function toNumber(value: unknown) {
  const numericValue = Number(value ?? 0);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function reservationStatusLabel(status: string) {
  return ({ PENDING: "Pending", CONFIRMED: "Confirmed", READY_FOR_PICKUP: "Ready for Pick-up", COMPLETED: "Completed", CANCELLED: "Cancelled", NO_SHOW: "No-show" } as Record<string, string>)[status] ?? status;
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

function buildTrendRows(rows: Array<{ key: string; sales: string | number; receipts: number }>, range: ResolvedReportRange) {
  const actual = new Map(rows.map((row) => [row.key, { key: row.key, day: trendLabel(row.key, range.granularity), sales: toNumber(row.sales), receipts: row.receipts }]));
  if (!range.from) return [...actual.values()];
  const first = range.granularity === "MONTHLY" ? range.from.slice(0, 7) : range.from;
  const last = range.granularity === "MONTHLY" ? range.to.slice(0, 7) : range.to;
  const result = [];
  for (let key = first; key <= last; key = nextTrendKey(key, range.granularity)) {
    result.push(actual.get(key) ?? { key, day: trendLabel(key, range.granularity), sales: 0, receipts: 0 });
  }
  return result;
}

async function buildReportSummary(options: FinancialReportInput = {}) {
  const range = resolveReportRange(options);
  type Row = {
    productMetrics: { totalProducts: number; lowStockItems: number; outOfStockItems: number; inventoryValue: string; unverifiedInventoryQuantity: number };
    reservationGroups: Array<{ status: string; count: number }>;
    saleAggregate: { totalSales: string; cogs: string; count: number; uncostedQuantity: number };
    collectionGroups: Array<{ channel: string; amount: string; count: number }>;
    methodGroups: Array<{ method: string; amount: string; count: number }>;
    commissaryMethodGroups: Array<{ method: string; amount: string; count: number }>;
    treasurerPaymentRows: Array<{ paymentId: string; paidAt: string; officialReceiptNumber: string; orderReference: string; items: string; amount: string }>;
    pendingReceiptCount: number;
    userGroups: Array<{ role: string; count: number }>;
    activeConversations: number;
    salesTrendRows: Array<{ key: string; sales: string; receipts: number }>;
    categorySalesRows: Array<{ category: string; sales: string; cogs: string; quantity: number }>;
    itemSalesRows: Array<{ productId: string; item: string; category: string; quantity: number; sales: string; cogs: string }>;
  };

  const rows = await withTransientPrismaReadRetry(() => prisma.$queryRaw<Row[]>(Prisma.sql`
    SELECT
      (SELECT jsonb_build_object(
        'totalProducts', COUNT(*)::integer,
        'lowStockItems', COUNT(*) FILTER (WHERE stock <= low_stock_threshold)::integer,
        'outOfStockItems', COUNT(*) FILTER (WHERE stock <= 0)::integer,
        'inventoryValue', COALESCE((SELECT SUM(quantity_remaining * unit_cost) FROM inventory_batches), 0)::text,
        'unverifiedInventoryQuantity', COALESCE((SELECT SUM(quantity_remaining) FROM inventory_batches WHERE cost_verified = false), 0)::integer
      ) FROM products WHERE is_active = true) AS "productMetrics",
      COALESCE((SELECT jsonb_agg(to_jsonb(grouped)) FROM (
        SELECT status::text AS status, COUNT(*)::integer AS count FROM reservations GROUP BY status
      ) grouped), '[]'::jsonb) AS "reservationGroups",
      (SELECT jsonb_build_object(
        'totalSales', COALESCE(SUM(sale_item.subtotal), 0)::text,
        'cogs', COALESCE(SUM(sale_item.cogs), 0)::text,
        'count', COUNT(DISTINCT sale_item.receipt_id)::integer,
        'uncostedQuantity', COALESCE(SUM(GREATEST(sale_item.quantity - sale_item.allocated_quantity, 0)), 0)::integer
      ) FROM (
        SELECT item.id, item.quantity, item.subtotal, receipt.id AS receipt_id,
          COALESCE(SUM(allocation.quantity), 0)::integer AS allocated_quantity,
          COALESCE(SUM(allocation.quantity * allocation.unit_cost), 0) AS cogs
        FROM reservation_items item
        INNER JOIN reservations reservation ON reservation.id = item.reservation_id
        INNER JOIN receipts receipt ON receipt.reservation_id = reservation.id
        INNER JOIN payments payment ON payment.reservation_id = reservation.id
        LEFT JOIN order_item_cost_allocations allocation ON allocation.reservation_item_id = item.id AND allocation.reversed_at IS NULL
        WHERE reservation.status = 'COMPLETED'::reservation_status
          AND receipt.status = 'VERIFIED'::receipt_status
          AND payment.status = 'PAID'::payment_record_status
          AND (${range.fromInclusive}::timestamptz IS NULL OR COALESCE(reservation.completed_at, receipt.verified_at, receipt.issued_at) >= ${range.fromInclusive})
          AND COALESCE(reservation.completed_at, receipt.verified_at, receipt.issued_at) < ${range.toExclusive}
          AND (${options.collectionChannel ?? null}::text IS NULL OR payment.collection_channel::text = ${options.collectionChannel ?? null}::text)
          AND (${options.categoryId ?? null}::uuid IS NULL OR COALESCE(item.category_id_snapshot, (SELECT category_id FROM products WHERE id = item.product_id)) = ${options.categoryId ?? null}::uuid)
        GROUP BY item.id, receipt.id
      ) sale_item) AS "saleAggregate",
      COALESCE((SELECT jsonb_agg(to_jsonb(grouped)) FROM (
        SELECT collection_channel::text AS channel, COALESCE(SUM(amount), 0)::text AS amount, COUNT(*)::integer AS count
        FROM payments WHERE status = 'PAID'::payment_record_status
          AND (${range.fromInclusive}::timestamptz IS NULL OR paid_at >= ${range.fromInclusive}) AND paid_at < ${range.toExclusive}
          AND (${options.collectionChannel ?? null}::text IS NULL OR collection_channel::text = ${options.collectionChannel ?? null}::text)
        GROUP BY collection_channel ORDER BY collection_channel
      ) grouped), '[]'::jsonb) AS "collectionGroups",
      COALESCE((SELECT jsonb_agg(to_jsonb(grouped)) FROM (
        SELECT payment_method::text AS method, COALESCE(SUM(amount), 0)::text AS amount, COUNT(*)::integer AS count
        FROM payments WHERE status = 'PAID'::payment_record_status
          AND (${range.fromInclusive}::timestamptz IS NULL OR paid_at >= ${range.fromInclusive}) AND paid_at < ${range.toExclusive}
          AND (${options.collectionChannel ?? null}::text IS NULL OR collection_channel::text = ${options.collectionChannel ?? null}::text)
        GROUP BY payment_method ORDER BY payment_method
      ) grouped), '[]'::jsonb) AS "methodGroups",
      COALESCE((SELECT jsonb_agg(to_jsonb(grouped)) FROM (
        SELECT payment_method::text AS method, COALESCE(SUM(amount), 0)::text AS amount, COUNT(*)::integer AS count
        FROM payments WHERE status = 'PAID'::payment_record_status
          AND collection_channel = 'COMMISSARY'::collection_channel
          AND (${range.fromInclusive}::timestamptz IS NULL OR paid_at >= ${range.fromInclusive}) AND paid_at < ${range.toExclusive}
          AND (${options.collectionChannel ?? null}::text IS NULL OR collection_channel::text = ${options.collectionChannel ?? null}::text)
        GROUP BY payment_method ORDER BY payment_method
      ) grouped), '[]'::jsonb) AS "commissaryMethodGroups",
      COALESCE((SELECT jsonb_agg(to_jsonb(grouped) ORDER BY grouped."paidAt" DESC) FROM (
        SELECT payment.id AS "paymentId", payment.paid_at AS "paidAt",
          payment.official_receipt_number AS "officialReceiptNumber",
          reservation.reference_code AS "orderReference", payment.amount::text AS amount,
          COALESCE((SELECT STRING_AGG(item.product_name_snapshot || ' x' || item.quantity::text, ', ' ORDER BY item.created_at)
            FROM reservation_items item WHERE item.reservation_id = reservation.id), 'No items') AS items
        FROM payments payment
        INNER JOIN reservations reservation ON reservation.id = payment.reservation_id
        WHERE payment.status = 'PAID'::payment_record_status
          AND payment.collection_channel = 'TREASURER'::collection_channel
          AND (${range.fromInclusive}::timestamptz IS NULL OR payment.paid_at >= ${range.fromInclusive}) AND payment.paid_at < ${range.toExclusive}
          AND (${options.collectionChannel ?? null}::text IS NULL OR payment.collection_channel::text = ${options.collectionChannel ?? null}::text)
      ) grouped), '[]'::jsonb) AS "treasurerPaymentRows",
      (SELECT COUNT(*)::integer FROM receipts WHERE status = 'PENDING'::receipt_status) AS "pendingReceiptCount",
      COALESCE((SELECT jsonb_agg(to_jsonb(grouped)) FROM (SELECT role::text AS role, COUNT(*)::integer AS count FROM profiles GROUP BY role) grouped), '[]'::jsonb) AS "userGroups",
      (SELECT COUNT(*)::integer FROM conversations WHERE status = 'OPEN') AS "activeConversations",
      COALESCE((SELECT jsonb_agg(to_jsonb(grouped)) FROM (
        SELECT CASE WHEN ${range.granularity}::text = 'MONTHLY'
          THEN TO_CHAR(COALESCE(reservation.completed_at, receipt.verified_at, receipt.issued_at) AT TIME ZONE 'Asia/Manila', 'YYYY-MM')
          ELSE TO_CHAR(COALESCE(reservation.completed_at, receipt.verified_at, receipt.issued_at) AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD') END AS key,
          COALESCE(SUM(item.subtotal), 0)::text AS sales, COUNT(DISTINCT receipt.id)::integer AS receipts
        FROM reservation_items item
        INNER JOIN reservations reservation ON reservation.id = item.reservation_id
        INNER JOIN receipts receipt ON receipt.reservation_id = reservation.id
        INNER JOIN payments payment ON payment.reservation_id = reservation.id
        WHERE reservation.status = 'COMPLETED'::reservation_status AND receipt.status = 'VERIFIED'::receipt_status AND payment.status = 'PAID'::payment_record_status
          AND (${range.fromInclusive}::timestamptz IS NULL OR COALESCE(reservation.completed_at, receipt.verified_at, receipt.issued_at) >= ${range.fromInclusive})
          AND COALESCE(reservation.completed_at, receipt.verified_at, receipt.issued_at) < ${range.toExclusive}
          AND (${options.collectionChannel ?? null}::text IS NULL OR payment.collection_channel::text = ${options.collectionChannel ?? null}::text)
          AND (${options.categoryId ?? null}::uuid IS NULL OR COALESCE(item.category_id_snapshot, (SELECT category_id FROM products WHERE id = item.product_id)) = ${options.categoryId ?? null}::uuid)
        GROUP BY key ORDER BY key
      ) grouped), '[]'::jsonb) AS "salesTrendRows",
      COALESCE((SELECT jsonb_agg(to_jsonb(grouped)) FROM (
        SELECT COALESCE(item.category_name_snapshot, category.name, 'Uncategorized') AS category,
          SUM(item.quantity)::integer AS quantity, COALESCE(SUM(item.subtotal), 0)::text AS sales,
          COALESCE(SUM((SELECT SUM(allocation.quantity * allocation.unit_cost) FROM order_item_cost_allocations allocation WHERE allocation.reservation_item_id = item.id AND allocation.reversed_at IS NULL)), 0)::text AS cogs
        FROM reservation_items item
        INNER JOIN reservations reservation ON reservation.id = item.reservation_id
        INNER JOIN receipts receipt ON receipt.reservation_id = reservation.id
        INNER JOIN payments payment ON payment.reservation_id = reservation.id
        INNER JOIN products product ON product.id = item.product_id INNER JOIN categories category ON category.id = product.category_id
        WHERE reservation.status = 'COMPLETED'::reservation_status AND receipt.status = 'VERIFIED'::receipt_status AND payment.status = 'PAID'::payment_record_status
          AND (${range.fromInclusive}::timestamptz IS NULL OR COALESCE(reservation.completed_at, receipt.verified_at, receipt.issued_at) >= ${range.fromInclusive})
          AND COALESCE(reservation.completed_at, receipt.verified_at, receipt.issued_at) < ${range.toExclusive}
          AND (${options.collectionChannel ?? null}::text IS NULL OR payment.collection_channel::text = ${options.collectionChannel ?? null}::text)
          AND (${options.categoryId ?? null}::uuid IS NULL OR COALESCE(item.category_id_snapshot, product.category_id) = ${options.categoryId ?? null}::uuid)
        GROUP BY COALESCE(item.category_name_snapshot, category.name, 'Uncategorized') ORDER BY SUM(item.subtotal) DESC
      ) grouped), '[]'::jsonb) AS "categorySalesRows",
      COALESCE((SELECT jsonb_agg(to_jsonb(grouped)) FROM (
        SELECT item.product_id AS "productId", item.product_name_snapshot AS item,
          COALESCE(item.category_name_snapshot, category.name, 'Uncategorized') AS category,
          SUM(item.quantity)::integer AS quantity, COALESCE(SUM(item.subtotal), 0)::text AS sales,
          COALESCE(SUM((SELECT SUM(allocation.quantity * allocation.unit_cost) FROM order_item_cost_allocations allocation WHERE allocation.reservation_item_id = item.id AND allocation.reversed_at IS NULL)), 0)::text AS cogs
        FROM reservation_items item
        INNER JOIN reservations reservation ON reservation.id = item.reservation_id
        INNER JOIN receipts receipt ON receipt.reservation_id = reservation.id
        INNER JOIN payments payment ON payment.reservation_id = reservation.id
        INNER JOIN products product ON product.id = item.product_id INNER JOIN categories category ON category.id = product.category_id
        WHERE reservation.status = 'COMPLETED'::reservation_status AND receipt.status = 'VERIFIED'::receipt_status AND payment.status = 'PAID'::payment_record_status
          AND (${range.fromInclusive}::timestamptz IS NULL OR COALESCE(reservation.completed_at, receipt.verified_at, receipt.issued_at) >= ${range.fromInclusive})
          AND COALESCE(reservation.completed_at, receipt.verified_at, receipt.issued_at) < ${range.toExclusive}
          AND (${options.collectionChannel ?? null}::text IS NULL OR payment.collection_channel::text = ${options.collectionChannel ?? null}::text)
          AND (${options.categoryId ?? null}::uuid IS NULL OR COALESCE(item.category_id_snapshot, product.category_id) = ${options.categoryId ?? null}::uuid)
        GROUP BY item.product_id, item.product_name_snapshot, COALESCE(item.category_name_snapshot, category.name, 'Uncategorized') ORDER BY SUM(item.subtotal) DESC
      ) grouped), '[]'::jsonb) AS "itemSalesRows"
  `));

  const payload = rows[0] ?? {
    productMetrics: { totalProducts: 0, lowStockItems: 0, outOfStockItems: 0, inventoryValue: "0", unverifiedInventoryQuantity: 0 },
    reservationGroups: [], saleAggregate: { totalSales: "0", cogs: "0", count: 0, uncostedQuantity: 0 }, collectionGroups: [], methodGroups: [], commissaryMethodGroups: [], treasurerPaymentRows: [], pendingReceiptCount: 0,
    userGroups: [], activeConversations: 0, salesTrendRows: [], categorySalesRows: [], itemSalesRows: []
  };
  const totalSales = toNumber(payload.saleAggregate.totalSales);
  const cogs = toNumber(payload.saleAggregate.cogs);
  const channels = Object.fromEntries(payload.collectionGroups.map((group) => [group.channel, group]));
  const methods = Object.fromEntries(payload.methodGroups.map((group) => [group.method, group]));
  const commissaryMethods = Object.fromEntries(payload.commissaryMethodGroups.map((group) => [group.method, group]));
  const roles = Object.fromEntries(payload.userGroups.map((group) => [group.role, group.count]));
  const totalReservations = payload.reservationGroups.reduce((sum, group) => sum + group.count, 0);
  return {
    range: { preset: range.preset, from: range.from, to: range.to, granularity: range.granularity, label: range.label },
    filters: { collectionChannel: options.collectionChannel ?? "ALL", categoryId: options.categoryId ?? null },
    totalSales, cogs, grossProfit: totalSales - cogs,
    commissaryCollection: toNumber(channels.COMMISSARY?.amount), treasurerCollection: toNumber(channels.TREASURER?.amount),
    collectionChannelBreakdown: {
      commissary: { amount: toNumber(channels.COMMISSARY?.amount), payments: channels.COMMISSARY?.count ?? 0 },
      treasurer: { amount: toNumber(channels.TREASURER?.amount), payments: channels.TREASURER?.count ?? 0 }
    },
    commissaryPaymentBreakdown: {
      cash: { amount: toNumber(commissaryMethods.CASH?.amount), payments: commissaryMethods.CASH?.count ?? 0 },
      gcash: { amount: toNumber(commissaryMethods.GCASH?.amount), payments: commissaryMethods.GCASH?.count ?? 0 },
      other: { amount: toNumber(commissaryMethods.OTHER?.amount), payments: commissaryMethods.OTHER?.count ?? 0 }
    },
    treasurerCollections: payload.treasurerPaymentRows.map((payment) => ({
      paymentId: payment.paymentId,
      paidAt: new Date(payment.paidAt).toISOString(),
      officialReceiptNumber: payment.officialReceiptNumber,
      orderReference: payment.orderReference,
      items: payment.items,
      amount: toNumber(payment.amount)
    })),
    onlineGcashRevenue: toNumber(methods.PAYMONGO_GCASH?.amount) + toNumber(methods.GCASH?.amount),
    payAtCommissaryRevenue: toNumber(channels.COMMISSARY?.amount),
    paymentMethodBreakdown: {
      onlineGcash: { amount: toNumber(methods.PAYMONGO_GCASH?.amount) + toNumber(methods.GCASH?.amount), receipts: (methods.PAYMONGO_GCASH?.count ?? 0) + (methods.GCASH?.count ?? 0) },
      payAtCommissary: { amount: toNumber(channels.COMMISSARY?.amount), receipts: channels.COMMISSARY?.count ?? 0 }
    },
    uncostedQuantity: payload.saleAggregate.uncostedQuantity,
    unverifiedInventoryQuantity: payload.productMetrics.unverifiedInventoryQuantity,
    totalReservations, pendingReservations: payload.reservationGroups.find((group) => group.status === "PENDING")?.count ?? 0,
    lowStockItems: payload.productMetrics.lowStockItems, outOfStockItems: payload.productMetrics.outOfStockItems,
    totalProducts: payload.productMetrics.totalProducts, inventoryValue: toNumber(payload.productMetrics.inventoryValue),
    activeUsers: payload.userGroups.reduce((sum, group) => sum + group.count, 0),
    roleCounts: { students: roles.STUDENT ?? 0, staff: roles.STAFF ?? 0, admins: roles.ADMIN ?? 0 },
    receiptsToVerify: payload.pendingReceiptCount, totalReceipts: payload.saleAggregate.count, activeConversations: payload.activeConversations,
    salesTrend: buildTrendRows(payload.salesTrendRows, range),
    categorySales: payload.categorySalesRows.map((row) => ({ category: row.category, quantity: row.quantity, amount: toNumber(row.sales), sales: toNumber(row.sales), cogs: toNumber(row.cogs), grossProfit: toNumber(row.sales) - toNumber(row.cogs) })),
    itemSales: payload.itemSalesRows.map((row) => ({ productId: row.productId, item: row.item, category: row.category, quantity: row.quantity, sales: toNumber(row.sales), cogs: toNumber(row.cogs), grossProfit: toNumber(row.sales) - toNumber(row.cogs) })),
    reservationStatusDistribution: payload.reservationGroups.map((group) => ({ status: group.status, label: reservationStatusLabel(group.status), value: group.count, percent: totalReservations ? Math.round(group.count / totalReservations * 1000) / 10 : 0 })),
    inventoryInsights: [
      { insight: `${payload.productMetrics.unverifiedInventoryQuantity} items need an opening acquisition cost`, impact: payload.productMetrics.unverifiedInventoryQuantity ? "High" : "Positive", recommendation: payload.productMetrics.unverifiedInventoryQuantity ? "Review migrated opening batches" : "All remaining inventory has verified costs" },
      { insight: `${payload.productMetrics.lowStockItems} items reached restock alert count`, impact: payload.productMetrics.lowStockItems ? "High" : "Positive", recommendation: payload.productMetrics.lowStockItems ? "Review restock priorities" : "Maintain current stock planning" },
      { insight: `${payload.activeConversations} open support conversations`, impact: payload.activeConversations ? "Medium" : "Positive", recommendation: payload.activeConversations ? "Assign staff replies" : "Support queue is clear" }
    ]
  };
}

const REPORT_CACHE_TTL_MS = 15_000;
const localCache = new Map<string, { value: Awaited<ReturnType<typeof buildReportSummary>>; expiresAt: number }>();
const reportRuntimeCache = getCache({ namespace: "wescomm-reports" });

export async function invalidateReportSummaryCache() {
  localCache.clear();
  await bumpCacheRevision("reports");
  await reportRuntimeCache.expireTag("reports").catch(() => undefined);
}

export async function getReportSummary(options: FinancialReportInput = {}, cacheOptions: { bypassCache?: boolean } = {}) {
  if (cacheOptions.bypassCache) return buildReportSummary(options);
  const range = resolveReportRange(options);
  const revision = await readCacheRevision("reports");
  const key = `summary:v5:${revision}:${range.cacheKey}:${options.collectionChannel ?? "ALL"}:${options.categoryId ?? "ALL"}`;
  const local = localCache.get(key);
  if (local && local.expiresAt > Date.now()) return local.value;
  const regional = await reportRuntimeCache.get(key).catch(() => null) as Awaited<ReturnType<typeof buildReportSummary>> | null;
  if (regional?.range && typeof regional.totalSales === "number") {
    localCache.set(key, { value: regional, expiresAt: Date.now() + REPORT_CACHE_TTL_MS });
    return regional;
  }
  const value = await buildReportSummary(options);
  localCache.set(key, { value, expiresAt: Date.now() + REPORT_CACHE_TTL_MS });
  await reportRuntimeCache.set(key, value, { ttl: 15, tags: ["reports"], name: "WESCOMM financial report" }).catch(() => undefined);
  return value;
}
