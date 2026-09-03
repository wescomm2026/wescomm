import { prisma } from "../lib/prisma.js";
import { getCache } from "@vercel/functions";
import { withTransientPrismaReadRetry } from "../utils/prisma-retry.js";

type DashboardPayloadRow = {
  metrics: {
    totalProducts: number;
    itemsToRestock: number;
    pendingReservations: number;
    activeReservations: number;
    receiptsToVerify: number;
    openConversations: number;
  };
  products: Array<Record<string, unknown>>;
  reservations: Array<Record<string, unknown>>;
  receipts: Array<Record<string, unknown>>;
};

async function buildStaffDashboardSummary() {
  const rows = await withTransientPrismaReadRetry(() => prisma.$queryRaw<DashboardPayloadRow[]>`
    SELECT
      jsonb_build_object(
        'totalProducts', (SELECT COUNT(*)::integer FROM products WHERE is_active = true),
        'itemsToRestock', (SELECT COUNT(*)::integer FROM products
          WHERE is_active = true
            AND (stock <= low_stock_threshold OR status IN ('RESTOCK_SOON', 'OUT_OF_STOCK'))),
        'pendingReservations', (SELECT COUNT(*)::integer FROM reservations WHERE status = 'PENDING'),
        'activeReservations', (SELECT COUNT(*)::integer FROM reservations
          WHERE status IN ('PENDING', 'CONFIRMED', 'READY_FOR_PICKUP')),
        'receiptsToVerify', (SELECT COUNT(*)::integer FROM receipts WHERE status = 'PENDING'),
        'openConversations', (SELECT COUNT(*)::integer FROM conversations WHERE status = 'OPEN')
      ) AS metrics,
      COALESCE((
        SELECT jsonb_agg(to_jsonb(product_row))
        FROM (
          SELECT
            p.id,
            p.category_id AS "categoryId",
            p.name,
            p.description,
            p.image_url AS "imageUrl",
            p.price::text AS price,
            p.old_price::text AS "oldPrice",
            (p.old_price IS NOT NULL AND p.old_price > p.price) AS "isOnSale",
            p.status::text AS status,
            p.stock,
            p.low_stock_threshold AS "lowStockThreshold",
            p.is_active AS "isActive",
            jsonb_build_object(
              'id', c.id,
              'name', c.name,
              'slug', c.slug,
              'iconUrl', c.icon_url,
              'isActive', c.is_active
            ) AS category,
            '[]'::jsonb AS variants
          FROM products p
          JOIN categories c ON c.id = p.category_id
          WHERE p.is_active = true
          ORDER BY
            CASE
              WHEN p.stock <= 0 OR p.status = 'OUT_OF_STOCK' THEN 0
              WHEN p.stock <= p.low_stock_threshold OR p.status = 'RESTOCK_SOON' THEN 1
              WHEN p.old_price IS NOT NULL AND p.old_price > p.price THEN 2
              ELSE 3
            END,
            p.name ASC
          LIMIT 5
        ) product_row
      ), '[]'::jsonb) AS products,
      COALESCE((
        SELECT jsonb_agg(to_jsonb(reservation_row))
        FROM (
          SELECT
            r.id,
            r.student_id AS "studentId",
            r.reference_code AS "referenceCode",
            r.status::text AS status,
            r.pickup_start AS "pickupStart",
            r.pickup_end AS "pickupEnd",
            r.payment_method::text AS "paymentMethod",
            r.total_amount::text AS "totalAmount",
            r.staff_notes AS "staffNotes",
            r.created_at AS "createdAt",
            r.updated_at AS "updatedAt",
            jsonb_build_object(
              'id', student.id,
              'fullName', student.full_name,
              'email', student.email,
              'studentNumber', student.student_number
            ) AS student,
            '[]'::jsonb AS items
          FROM reservations r
          JOIN profiles student ON student.id = r.student_id
          WHERE r.status IN ('PENDING', 'CONFIRMED', 'READY_FOR_PICKUP')
          ORDER BY r.created_at DESC
          LIMIT 5
        ) reservation_row
      ), '[]'::jsonb) AS reservations,
      COALESCE((
        SELECT jsonb_agg(to_jsonb(receipt_row))
        FROM (
          SELECT
            receipt.id,
            receipt.receipt_code AS "receiptCode",
            receipt.student_id AS "studentId",
            receipt.reservation_id AS "reservationId",
            receipt.total_amount::text AS "totalAmount",
            receipt.payment_method::text AS "paymentMethod",
            receipt.status::text AS status,
            receipt.verification_hash AS "verificationHash",
            receipt.receipt_image_url AS "receiptImageUrl",
            receipt.receipt_pdf_url AS "receiptPdfUrl",
            receipt.issued_by_id AS "issuedById",
            receipt.issued_at AS "issuedAt",
            receipt.created_at AS "createdAt",
            receipt.updated_at AS "updatedAt"
          FROM receipts receipt
          WHERE receipt.status = 'PENDING'
          ORDER BY receipt.issued_at DESC
          LIMIT 5
        ) receipt_row
      ), '[]'::jsonb) AS receipts
  `);

  return rows[0] ?? {
    metrics: {
      totalProducts: 0,
      itemsToRestock: 0,
      pendingReservations: 0,
      activeReservations: 0,
      receiptsToVerify: 0,
      openConversations: 0
    },
    products: [],
    reservations: [],
    receipts: []
  };
}

const DASHBOARD_CACHE_TTL_MS = 10_000;
const DASHBOARD_CACHE_TTL_SECONDS = DASHBOARD_CACHE_TTL_MS / 1_000;
const DASHBOARD_CACHE_KEY = "staff-summary:v2";
type StaffDashboardSummary = Awaited<ReturnType<typeof buildStaffDashboardSummary>>;

let cachedDashboard: { value: StaffDashboardSummary; expiresAt: number } | null = null;
let pendingDashboard: Promise<StaffDashboardSummary> | null = null;
const dashboardRuntimeCache = getCache({ namespace: "wescomm-dashboard" });

function isStaffDashboardSummary(value: unknown): value is StaffDashboardSummary {
  return Boolean(
    value
    && typeof value === "object"
    && typeof (value as Partial<StaffDashboardSummary>).metrics === "object"
    && Array.isArray((value as Partial<StaffDashboardSummary>).products)
    && Array.isArray((value as Partial<StaffDashboardSummary>).reservations)
    && Array.isArray((value as Partial<StaffDashboardSummary>).receipts)
  );
}

export async function invalidateStaffDashboardCache() {
  cachedDashboard = null;
  await Promise.all([
    dashboardRuntimeCache.delete(DASHBOARD_CACHE_KEY),
    dashboardRuntimeCache.expireTag("dashboard")
  ]).catch(() => undefined);
}

export async function getStaffDashboardSummary() {
  if (cachedDashboard && cachedDashboard.expiresAt > Date.now()) return cachedDashboard.value;
  if (pendingDashboard) return pendingDashboard;

  pendingDashboard = (async () => {
    const regionalValue = await dashboardRuntimeCache.get(DASHBOARD_CACHE_KEY).catch(() => null);
    if (isStaffDashboardSummary(regionalValue)) {
      cachedDashboard = { value: regionalValue, expiresAt: Date.now() + DASHBOARD_CACHE_TTL_MS };
      return regionalValue;
    }

    const value = await buildStaffDashboardSummary();
    cachedDashboard = { value, expiresAt: Date.now() + DASHBOARD_CACHE_TTL_MS };
    await dashboardRuntimeCache.set(DASHBOARD_CACHE_KEY, value, {
      ttl: DASHBOARD_CACHE_TTL_SECONDS,
      tags: ["dashboard"],
      name: "WESCOMM staff dashboard summary"
    }).catch(() => undefined);
    return value;
  })()
    .finally(() => {
      pendingDashboard = null;
    });

  return pendingDashboard;
}
