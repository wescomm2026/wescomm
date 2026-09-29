import { Prisma } from "@prisma/client";
import { getCache } from "@vercel/functions";
import { bumpCacheRevision, readCacheRevision } from "./cache-revision.service.js";
import { resolveReportRange, type ReportRangeInput, type ResolvedReportRange } from "../domain/report-range.js";
import { classifyReportPaymentRevenue } from "../domain/report-payment-classification.js";
import {
  buildInventoryPlanning,
  buildReportComparisonMetric,
  reconciliationLabel,
  type ReportBasis,
  type ReportReconciliationType
} from "../domain/report-insights.js";
import { prisma } from "../lib/prisma.js";
import { withTransientPrismaReadRetry } from "../utils/prisma-retry.js";
import type { CollectionChannel } from "../types/app.js";

export type FinancialReportInput = ReportRangeInput & {
  collectionChannel?: CollectionChannel;
  categoryId?: string;
  basis?: ReportBasis;
};

const CASH_ONLY_EFFECTIVE_AT = new Date("2026-09-28T00:00:00+08:00");
const MAX_RECONCILIATION_ROWS = 100;

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

function previousReportWindow(range: ResolvedReportRange) {
  if (!range.fromInclusive) return { fromInclusive: null, toExclusive: null, label: null };
  const durationMs = range.toExclusive.getTime() - range.fromInclusive.getTime();
  const fromInclusive = new Date(range.fromInclusive.getTime() - durationMs);
  return {
    fromInclusive,
    toExclusive: range.fromInclusive,
    label: `${fromInclusive.toLocaleDateString("en-PH", { timeZone: "Asia/Manila" })} to ${new Date(range.fromInclusive.getTime() - 1).toLocaleDateString("en-PH", { timeZone: "Asia/Manila" })}`
  };
}

function reportObservationDays(range: ResolvedReportRange) {
  if (!range.fromInclusive) return 30;
  return Math.max(1, Math.round((range.toExclusive.getTime() - range.fromInclusive.getTime()) / 86_400_000));
}

async function buildReportSummary(options: FinancialReportInput = {}) {
  const range = resolveReportRange(options);
  type Row = {
    productMetrics: { totalProducts: number; lowStockItems: number; outOfStockItems: number; inventoryValue: string; unverifiedInventoryQuantity: number };
    reservationGroups: Array<{ status: string; count: number }>;
    saleAggregate: { totalSales: string; cogs: string; count: number; uncostedQuantity: number };
    collectionGroups: Array<{ channel: string; amount: string; count: number }>;
    cashChannelGroups: Array<{ channel: string; amount: string; count: number }>;
    methodGroups: Array<{ method: string; amount: string; count: number }>;
    commissaryMethodGroups: Array<{ method: string; amount: string; count: number }>;
    treasurerPaymentRows: Array<{ paymentId: string; paidAt: string; officialReceiptNumber: string | null; orderReference: string; items: string; amount: string }>;
    pendingReceiptCount: number;
    userGroups: Array<{ role: string; count: number }>;
    activeConversations: number;
    salesTrendRows: Array<{ key: string; sales: string; receipts: number }>;
    categorySalesRows: Array<{ category: string; sales: string; cogs: string; quantity: number }>;
    itemSalesRows: Array<{ productId: string; item: string; category: string; quantity: number; sales: string; cogs: string }>;
  };

  type ComparisonRow = {
    totalSales: string;
    cogs: string;
    cashRevenue: string;
    totalReservations: number;
  };
  type ReconciliationRow = {
    type: ReportReconciliationType;
    severity: "HIGH" | "MEDIUM";
    reservationId: string;
    referenceCode: string;
    paymentId: string | null;
    receiptId: string | null;
    eventAt: Date;
    amount: string;
  };
  type InventoryPlanningRow = {
    productId: string;
    item: string;
    category: string;
    stock: number;
    lowStockThreshold: number;
    unitsSold: number;
    sales: string;
    cogs: string;
    lastSoldAt: Date | null;
  };
  type CashTrendRow = { key: string; sales: string; receipts: number };

  const comparisonWindow = previousReportWindow(range);
  const basis = options.basis ?? "COLLECTION";

  const [rows, comparisonRows, reconciliationRows, inventoryPlanningRows, cashTrendRows] = await withTransientPrismaReadRetry(() => Promise.all([
    prisma.$queryRaw<Row[]>(Prisma.sql`
    SELECT
      (SELECT jsonb_build_object(
        'totalProducts', COUNT(*)::integer,
        'lowStockItems', COUNT(*) FILTER (WHERE stock <= low_stock_threshold)::integer,
        'outOfStockItems', COUNT(*) FILTER (WHERE stock <= 0)::integer,
        'inventoryValue', COALESCE((SELECT SUM(quantity_remaining * unit_cost) FROM inventory_batches), 0)::text,
        'unverifiedInventoryQuantity', COALESCE((SELECT SUM(quantity_remaining) FROM inventory_batches WHERE cost_verified = false), 0)::integer
      ) FROM products WHERE is_active = true) AS "productMetrics",
      COALESCE((SELECT jsonb_agg(to_jsonb(grouped)) FROM (
        SELECT reservation.status::text AS status, COUNT(*)::integer AS count
        FROM reservations reservation
        WHERE (${range.fromInclusive}::timestamptz IS NULL OR reservation.created_at >= ${range.fromInclusive})
          AND reservation.created_at < ${range.toExclusive}
          AND (${options.collectionChannel ?? null}::text IS NULL OR reservation.preferred_collection_channel::text = ${options.collectionChannel ?? null}::text)
          AND (${options.categoryId ?? null}::uuid IS NULL OR EXISTS (
            SELECT 1 FROM reservation_items item WHERE item.reservation_id = reservation.id
              AND COALESCE(item.category_id_snapshot, (SELECT category_id FROM products WHERE id = item.product_id)) = ${options.categoryId ?? null}::uuid
          ))
        GROUP BY reservation.status
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
        SELECT collection_channel::text AS channel, COALESCE(SUM(amount), 0)::text AS amount, COUNT(*)::integer AS count
        FROM payments WHERE status = 'PAID'::payment_record_status
          AND payment_method = 'CASH'::payment_method
          AND (${range.fromInclusive}::timestamptz IS NULL OR paid_at >= ${range.fromInclusive}) AND paid_at < ${range.toExclusive}
          AND (${options.collectionChannel ?? null}::text IS NULL OR collection_channel::text = ${options.collectionChannel ?? null}::text)
        GROUP BY collection_channel ORDER BY collection_channel
      ) grouped), '[]'::jsonb) AS "cashChannelGroups",
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
  `),
    prisma.$queryRaw<ComparisonRow[]>(Prisma.sql`
      SELECT
        COALESCE((SELECT SUM(previous_item.subtotal) FROM (
          SELECT item.id, item.subtotal
          FROM reservation_items item
          INNER JOIN reservations reservation ON reservation.id = item.reservation_id
          INNER JOIN receipts receipt ON receipt.reservation_id = reservation.id
          INNER JOIN payments payment ON payment.reservation_id = reservation.id
          WHERE ${comparisonWindow.fromInclusive}::timestamptz IS NOT NULL
            AND reservation.status = 'COMPLETED'::reservation_status
            AND receipt.status = 'VERIFIED'::receipt_status
            AND payment.status = 'PAID'::payment_record_status
            AND COALESCE(reservation.completed_at, receipt.verified_at, receipt.issued_at) >= ${comparisonWindow.fromInclusive}
            AND COALESCE(reservation.completed_at, receipt.verified_at, receipt.issued_at) < ${comparisonWindow.toExclusive}
            AND (${options.collectionChannel ?? null}::text IS NULL OR payment.collection_channel::text = ${options.collectionChannel ?? null}::text)
            AND (${options.categoryId ?? null}::uuid IS NULL OR COALESCE(item.category_id_snapshot, (SELECT category_id FROM products WHERE id = item.product_id)) = ${options.categoryId ?? null}::uuid)
        ) previous_item), 0)::text AS "totalSales",
        COALESCE((SELECT SUM(allocation.quantity * allocation.unit_cost)
          FROM order_item_cost_allocations allocation
          INNER JOIN reservation_items item ON item.id = allocation.reservation_item_id
          INNER JOIN reservations reservation ON reservation.id = item.reservation_id
          INNER JOIN receipts receipt ON receipt.reservation_id = reservation.id
          INNER JOIN payments payment ON payment.reservation_id = reservation.id
          WHERE ${comparisonWindow.fromInclusive}::timestamptz IS NOT NULL
            AND allocation.reversed_at IS NULL
            AND reservation.status = 'COMPLETED'::reservation_status
            AND receipt.status = 'VERIFIED'::receipt_status
            AND payment.status = 'PAID'::payment_record_status
            AND COALESCE(reservation.completed_at, receipt.verified_at, receipt.issued_at) >= ${comparisonWindow.fromInclusive}
            AND COALESCE(reservation.completed_at, receipt.verified_at, receipt.issued_at) < ${comparisonWindow.toExclusive}
            AND (${options.collectionChannel ?? null}::text IS NULL OR payment.collection_channel::text = ${options.collectionChannel ?? null}::text)
            AND (${options.categoryId ?? null}::uuid IS NULL OR COALESCE(item.category_id_snapshot, (SELECT category_id FROM products WHERE id = item.product_id)) = ${options.categoryId ?? null}::uuid)
        ), 0)::text AS cogs,
        COALESCE((SELECT SUM(amount) FROM payments
          WHERE ${comparisonWindow.fromInclusive}::timestamptz IS NOT NULL
            AND status = 'PAID'::payment_record_status
            AND payment_method = 'CASH'::payment_method
            AND paid_at >= ${comparisonWindow.fromInclusive} AND paid_at < ${comparisonWindow.toExclusive}
            AND (${options.collectionChannel ?? null}::text IS NULL OR collection_channel::text = ${options.collectionChannel ?? null}::text)
        ), 0)::text AS "cashRevenue",
        COALESCE((SELECT COUNT(*) FROM reservations reservation
          WHERE ${comparisonWindow.fromInclusive}::timestamptz IS NOT NULL
            AND reservation.created_at >= ${comparisonWindow.fromInclusive} AND reservation.created_at < ${comparisonWindow.toExclusive}
            AND (${options.collectionChannel ?? null}::text IS NULL OR reservation.preferred_collection_channel::text = ${options.collectionChannel ?? null}::text)
            AND (${options.categoryId ?? null}::uuid IS NULL OR EXISTS (
              SELECT 1 FROM reservation_items item WHERE item.reservation_id = reservation.id
                AND COALESCE(item.category_id_snapshot, (SELECT category_id FROM products WHERE id = item.product_id)) = ${options.categoryId ?? null}::uuid
            ))
        ), 0)::integer AS "totalReservations"
    `),
    prisma.$queryRaw<ReconciliationRow[]>(Prisma.sql`
      WITH exceptions AS (
        SELECT 'MISSING_TREASURY_OR'::text AS type, 'HIGH'::text AS severity,
          reservation.id AS "reservationId", reservation.reference_code AS "referenceCode",
          payment.id AS "paymentId", receipt.id AS "receiptId", payment.paid_at AS "eventAt", payment.amount::text AS amount
        FROM payments payment
        INNER JOIN reservations reservation ON reservation.id = payment.reservation_id
        LEFT JOIN receipts receipt ON receipt.reservation_id = reservation.id
        WHERE payment.status = 'PAID'::payment_record_status
          AND payment.collection_channel = 'TREASURER'::collection_channel
          AND NULLIF(BTRIM(payment.official_receipt_number), '') IS NULL
          AND (${range.fromInclusive}::timestamptz IS NULL OR payment.paid_at >= ${range.fromInclusive}) AND payment.paid_at < ${range.toExclusive}
          AND (${options.collectionChannel ?? null}::text IS NULL OR payment.collection_channel::text = ${options.collectionChannel ?? null}::text)
        UNION ALL
        SELECT 'PAYMENT_RECEIPT_MISMATCH', 'HIGH', reservation.id, reservation.reference_code,
          payment.id, receipt.id, payment.paid_at, ABS(payment.amount - receipt.total_amount)::text
        FROM payments payment
        INNER JOIN reservations reservation ON reservation.id = payment.reservation_id
        INNER JOIN receipts receipt ON receipt.reservation_id = reservation.id
        WHERE payment.status = 'PAID'::payment_record_status AND receipt.status = 'VERIFIED'::receipt_status
          AND payment.amount <> receipt.total_amount
          AND (${range.fromInclusive}::timestamptz IS NULL OR payment.paid_at >= ${range.fromInclusive}) AND payment.paid_at < ${range.toExclusive}
          AND (${options.collectionChannel ?? null}::text IS NULL OR payment.collection_channel::text = ${options.collectionChannel ?? null}::text)
        UNION ALL
        SELECT 'COMPLETED_WITHOUT_PAID_PAYMENT', 'HIGH', reservation.id, reservation.reference_code,
          NULL::uuid, receipt.id, COALESCE(reservation.completed_at, reservation.updated_at), reservation.total_amount::text
        FROM reservations reservation
        LEFT JOIN receipts receipt ON receipt.reservation_id = reservation.id
        WHERE reservation.status = 'COMPLETED'::reservation_status
          AND NOT EXISTS (SELECT 1 FROM payments payment WHERE payment.reservation_id = reservation.id AND payment.status = 'PAID'::payment_record_status)
          AND (${range.fromInclusive}::timestamptz IS NULL OR COALESCE(reservation.completed_at, reservation.updated_at) >= ${range.fromInclusive})
          AND COALESCE(reservation.completed_at, reservation.updated_at) < ${range.toExclusive}
          AND (${options.collectionChannel ?? null}::text IS NULL OR reservation.preferred_collection_channel::text = ${options.collectionChannel ?? null}::text)
        UNION ALL
        SELECT 'COMPLETED_WITHOUT_VERIFIED_RECEIPT', 'HIGH', reservation.id, reservation.reference_code,
          payment.id, receipt.id, COALESCE(reservation.completed_at, reservation.updated_at), reservation.total_amount::text
        FROM reservations reservation
        LEFT JOIN payments payment ON payment.reservation_id = reservation.id AND payment.status = 'PAID'::payment_record_status
        LEFT JOIN receipts receipt ON receipt.reservation_id = reservation.id AND receipt.status = 'VERIFIED'::receipt_status
        WHERE reservation.status = 'COMPLETED'::reservation_status AND receipt.id IS NULL
          AND (${range.fromInclusive}::timestamptz IS NULL OR COALESCE(reservation.completed_at, reservation.updated_at) >= ${range.fromInclusive})
          AND COALESCE(reservation.completed_at, reservation.updated_at) < ${range.toExclusive}
          AND (${options.collectionChannel ?? null}::text IS NULL OR COALESCE(payment.collection_channel, reservation.preferred_collection_channel)::text = ${options.collectionChannel ?? null}::text)
        UNION ALL
        SELECT 'PAID_NOT_COMPLETED', 'MEDIUM', reservation.id, reservation.reference_code,
          payment.id, receipt.id, payment.paid_at, payment.amount::text
        FROM payments payment
        INNER JOIN reservations reservation ON reservation.id = payment.reservation_id
        LEFT JOIN receipts receipt ON receipt.reservation_id = reservation.id
        WHERE payment.status = 'PAID'::payment_record_status AND reservation.status <> 'COMPLETED'::reservation_status
          AND (${range.fromInclusive}::timestamptz IS NULL OR payment.paid_at >= ${range.fromInclusive}) AND payment.paid_at < ${range.toExclusive}
          AND (${options.collectionChannel ?? null}::text IS NULL OR payment.collection_channel::text = ${options.collectionChannel ?? null}::text)
        UNION ALL
        SELECT 'POST_CUTOVER_NON_CASH', 'HIGH', reservation.id, reservation.reference_code,
          payment.id, receipt.id, payment.paid_at, payment.amount::text
        FROM payments payment
        INNER JOIN reservations reservation ON reservation.id = payment.reservation_id
        LEFT JOIN receipts receipt ON receipt.reservation_id = reservation.id
        WHERE payment.status = 'PAID'::payment_record_status AND payment.payment_method <> 'CASH'::payment_method
          AND payment.paid_at >= ${CASH_ONLY_EFFECTIVE_AT}
          AND (${range.fromInclusive}::timestamptz IS NULL OR payment.paid_at >= ${range.fromInclusive}) AND payment.paid_at < ${range.toExclusive}
          AND (${options.collectionChannel ?? null}::text IS NULL OR payment.collection_channel::text = ${options.collectionChannel ?? null}::text)
      )
      SELECT * FROM exceptions ORDER BY "eventAt" DESC, "referenceCode" ASC LIMIT ${MAX_RECONCILIATION_ROWS + 1}
    `),
    prisma.$queryRaw<InventoryPlanningRow[]>(Prisma.sql`
      SELECT product.id AS "productId", product.name AS item, category.name AS category,
        product.stock::integer AS stock, product.low_stock_threshold::integer AS "lowStockThreshold",
        COALESCE(sale.quantity, 0)::integer AS "unitsSold", COALESCE(sale.sales, 0)::text AS sales,
        COALESCE(sale.cogs, 0)::text AS cogs, sale."lastSoldAt"
      FROM products product
      INNER JOIN categories category ON category.id = product.category_id
      LEFT JOIN LATERAL (
        SELECT SUM(item.quantity)::integer AS quantity, SUM(item.subtotal) AS sales,
          SUM(COALESCE((SELECT SUM(allocation.quantity * allocation.unit_cost)
            FROM order_item_cost_allocations allocation
            WHERE allocation.reservation_item_id = item.id AND allocation.reversed_at IS NULL), 0)) AS cogs,
          MAX(COALESCE(reservation.completed_at, receipt.verified_at, receipt.issued_at)) AS "lastSoldAt"
        FROM reservation_items item
        INNER JOIN reservations reservation ON reservation.id = item.reservation_id
        INNER JOIN receipts receipt ON receipt.reservation_id = reservation.id
        INNER JOIN payments payment ON payment.reservation_id = reservation.id
        WHERE item.product_id = product.id
          AND reservation.status = 'COMPLETED'::reservation_status
          AND receipt.status = 'VERIFIED'::receipt_status
          AND payment.status = 'PAID'::payment_record_status
          AND (${range.fromInclusive}::timestamptz IS NULL OR COALESCE(reservation.completed_at, receipt.verified_at, receipt.issued_at) >= ${range.fromInclusive})
          AND COALESCE(reservation.completed_at, receipt.verified_at, receipt.issued_at) < ${range.toExclusive}
          AND (${options.collectionChannel ?? null}::text IS NULL OR payment.collection_channel::text = ${options.collectionChannel ?? null}::text)
      ) sale ON TRUE
      WHERE product.is_active = true
        AND (${options.categoryId ?? null}::uuid IS NULL OR product.category_id = ${options.categoryId ?? null}::uuid)
      ORDER BY (product.stock <= product.low_stock_threshold) DESC, COALESCE(sale.quantity, 0) ASC, product.name ASC
      LIMIT 200
    `),
    prisma.$queryRaw<CashTrendRow[]>(Prisma.sql`
      SELECT CASE WHEN ${range.granularity}::text = 'MONTHLY'
        THEN TO_CHAR(paid_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM')
        ELSE TO_CHAR(paid_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD') END AS key,
        COALESCE(SUM(amount), 0)::text AS sales, COUNT(*)::integer AS receipts
      FROM payments
      WHERE status = 'PAID'::payment_record_status AND payment_method = 'CASH'::payment_method
        AND (${range.fromInclusive}::timestamptz IS NULL OR paid_at >= ${range.fromInclusive}) AND paid_at < ${range.toExclusive}
        AND (${options.collectionChannel ?? null}::text IS NULL OR collection_channel::text = ${options.collectionChannel ?? null}::text)
      GROUP BY key ORDER BY key
    `)
  ]));

  const payload = rows[0] ?? {
    productMetrics: { totalProducts: 0, lowStockItems: 0, outOfStockItems: 0, inventoryValue: "0", unverifiedInventoryQuantity: 0 },
    reservationGroups: [], saleAggregate: { totalSales: "0", cogs: "0", count: 0, uncostedQuantity: 0 }, collectionGroups: [], cashChannelGroups: [], methodGroups: [], commissaryMethodGroups: [], treasurerPaymentRows: [], pendingReceiptCount: 0,
    userGroups: [], activeConversations: 0, salesTrendRows: [], categorySalesRows: [], itemSalesRows: []
  };
  const totalSales = toNumber(payload.saleAggregate.totalSales);
  const cogs = toNumber(payload.saleAggregate.cogs);
  const channels = Object.fromEntries(payload.collectionGroups.map((group) => [group.channel, group]));
  const commissaryMethods = Object.fromEntries(payload.commissaryMethodGroups.map((group) => [group.method, group]));
  const paymentRevenue = classifyReportPaymentRevenue({
    methodGroups: payload.methodGroups,
    cashChannelGroups: payload.cashChannelGroups
  });
  const roles = Object.fromEntries(payload.userGroups.map((group) => [group.role, group.count]));
  const totalReservations = payload.reservationGroups.reduce((sum, group) => sum + group.count, 0);
  const grossProfit = totalSales - cogs;
  const previous = comparisonRows[0] ?? { totalSales: "0", cogs: "0", cashRevenue: "0", totalReservations: 0 };
  const previousSales = toNumber(previous.totalSales);
  const previousCogs = toNumber(previous.cogs);
  const visibleReconciliationRows = reconciliationRows.slice(0, MAX_RECONCILIATION_ROWS);
  const riskTypes = new Set<ReportReconciliationType>([
    "PAYMENT_RECEIPT_MISMATCH",
    "COMPLETED_WITHOUT_PAID_PAYMENT",
    "PAID_NOT_COMPLETED"
  ]);
  const riskByReservation = new Map<string, number>();
  for (const row of visibleReconciliationRows) {
    if (!riskTypes.has(row.type)) continue;
    riskByReservation.set(row.reservationId, Math.max(riskByReservation.get(row.reservationId) ?? 0, toNumber(row.amount)));
  }
  const reconciliationItems = visibleReconciliationRows.map((row) => ({
    type: row.type,
    label: reconciliationLabel(row.type),
    severity: row.severity,
    reservationId: row.reservationId,
    referenceCode: row.referenceCode,
    paymentId: row.paymentId,
    receiptId: row.receiptId,
    eventAt: new Date(row.eventAt).toISOString(),
    amount: toNumber(row.amount)
  }));
  const reconciliationCounts = Object.fromEntries(
    reconciliationItems.reduce<Map<ReportReconciliationType, number>>((counts, item) => {
      counts.set(item.type, (counts.get(item.type) ?? 0) + 1);
      return counts;
    }, new Map())
  );
  const observationDays = reportObservationDays(range);
  const inventoryPlanning = inventoryPlanningRows.map((row) => {
    const sales = toNumber(row.sales);
    const cogsValue = toNumber(row.cogs);
    return {
      productId: row.productId,
      item: row.item,
      category: row.category,
      stock: row.stock,
      lowStockThreshold: row.lowStockThreshold,
      unitsSold: row.unitsSold,
      sales,
      cogs: cogsValue,
      lastSoldAt: row.lastSoldAt ? new Date(row.lastSoldAt).toISOString() : null,
      ...buildInventoryPlanning({
        stock: row.stock,
        lowStockThreshold: row.lowStockThreshold,
        unitsSold: row.unitsSold,
        sales,
        cogs: cogsValue,
        observationDays
      })
    };
  });
  return {
    generatedAt: new Date().toISOString(),
    range: { preset: range.preset, from: range.from, to: range.to, granularity: range.granularity, label: range.label },
    filters: { collectionChannel: options.collectionChannel ?? "ALL", categoryId: options.categoryId ?? null, basis },
    reportBasis: basis,
    cashOnlyPolicy: { effectiveAt: CASH_ONLY_EFFECTIVE_AT.toISOString(), enabled: true },
    totalSales, cogs, grossProfit,
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
    cashRevenue: paymentRevenue.cash.amount,
    commissaryCashRevenue: paymentRevenue.commissaryCash.amount,
    treasuryCashRevenue: paymentRevenue.treasuryCash.amount,
    inPersonRevenue: paymentRevenue.inPerson.amount,
    legacyOnlineRevenue: paymentRevenue.legacyOnline.amount,
    legacyInPersonRevenue: paymentRevenue.legacyInPerson.amount,
    paymentMethodBreakdown: {
      cash: { amount: paymentRevenue.cash.amount, receipts: paymentRevenue.cash.payments },
      inPerson: { amount: paymentRevenue.inPerson.amount, receipts: paymentRevenue.inPerson.payments },
      legacyOnline: { amount: paymentRevenue.legacyOnline.amount, receipts: paymentRevenue.legacyOnline.payments },
      legacyInPerson: { amount: paymentRevenue.legacyInPerson.amount, receipts: paymentRevenue.legacyInPerson.payments }
    },
    cashCollectionChannelBreakdown: {
      commissary: { amount: paymentRevenue.commissaryCash.amount, payments: paymentRevenue.commissaryCash.payments },
      treasurer: { amount: paymentRevenue.treasuryCash.amount, payments: paymentRevenue.treasuryCash.payments }
    },
    uncostedQuantity: payload.saleAggregate.uncostedQuantity,
    unverifiedInventoryQuantity: payload.productMetrics.unverifiedInventoryQuantity,
    totalReservations, pendingReservations: payload.reservationGroups.find((group) => group.status === "PENDING")?.count ?? 0,
    lowStockItems: payload.productMetrics.lowStockItems, outOfStockItems: payload.productMetrics.outOfStockItems,
    totalProducts: payload.productMetrics.totalProducts, inventoryValue: toNumber(payload.productMetrics.inventoryValue),
    activeUsers: payload.userGroups.reduce((sum, group) => sum + group.count, 0),
    roleCounts: { students: roles.STUDENT ?? 0, staff: roles.STAFF ?? 0, admins: roles.ADMIN ?? 0 },
    receiptsToVerify: payload.pendingReceiptCount, totalReceipts: payload.saleAggregate.count, activeConversations: payload.activeConversations,
    comparison: {
      available: Boolean(comparisonWindow.fromInclusive),
      label: comparisonWindow.label,
      cashRevenue: buildReportComparisonMetric(paymentRevenue.cash.amount, toNumber(previous.cashRevenue)),
      recognizedSales: buildReportComparisonMetric(totalSales, previousSales),
      grossProfit: buildReportComparisonMetric(grossProfit, previousSales - previousCogs),
      reservations: buildReportComparisonMetric(totalReservations, previous.totalReservations)
    },
    reconciliation: {
      status: reconciliationItems.length ? "NEEDS_REVIEW" : "CLEAN",
      exceptionCount: reconciliationItems.length,
      amountAtRisk: [...riskByReservation.values()].reduce((sum, amount) => sum + amount, 0),
      truncated: reconciliationRows.length > MAX_RECONCILIATION_ROWS,
      counts: reconciliationCounts,
      items: reconciliationItems
    },
    salesTrend: buildTrendRows(payload.salesTrendRows, range),
    collectionTrend: buildTrendRows(cashTrendRows, range),
    categorySales: payload.categorySalesRows.map((row) => ({ category: row.category, quantity: row.quantity, amount: toNumber(row.sales), sales: toNumber(row.sales), cogs: toNumber(row.cogs), grossProfit: toNumber(row.sales) - toNumber(row.cogs) })),
    itemSales: payload.itemSalesRows.map((row) => {
      const sales = toNumber(row.sales);
      const itemCogs = toNumber(row.cogs);
      const itemGrossProfit = sales - itemCogs;
      return {
        productId: row.productId,
        item: row.item,
        category: row.category,
        quantity: row.quantity,
        sales,
        cogs: itemCogs,
        grossProfit: itemGrossProfit,
        marginPercent: sales > 0 ? Math.round((itemGrossProfit / sales) * 1_000) / 10 : null
      };
    }),
    inventoryPlanning,
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
  const key = `summary:v7:${revision}:${range.cacheKey}:${options.collectionChannel ?? "ALL"}:${options.categoryId ?? "ALL"}:${options.basis ?? "COLLECTION"}`;
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
