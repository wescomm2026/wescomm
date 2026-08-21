import { prisma } from "../lib/prisma.js";
import { withTransientPrismaReadRetry } from "../utils/prisma-retry.js";

type DashboardCountRow = {
  total_products: bigint;
  items_to_restock: bigint;
  pending_reservations: bigint;
  active_reservations: bigint;
  receipts_to_verify: bigint;
  open_conversations: bigint;
};

type DashboardProductRow = {
  id: string;
  category_id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  price: unknown;
  old_price: unknown;
  status: string;
  stock: number;
  low_stock_threshold: number;
  is_active: boolean;
  category_name: string;
  category_slug: string;
  category_icon_url: string | null;
  category_is_active: boolean;
};

function count(value: bigint | undefined) {
  return Number(value ?? 0n);
}

export async function getStaffDashboardSummary() {
  const [countRows, productRows, reservations, receipts] = await withTransientPrismaReadRetry(() =>
    prisma.$transaction([
      prisma.$queryRaw<DashboardCountRow[]>`
        SELECT
          (SELECT COUNT(*) FROM products WHERE is_active = true) AS total_products,
          (SELECT COUNT(*) FROM products
            WHERE is_active = true
              AND (stock <= low_stock_threshold OR status IN ('RESTOCK_SOON', 'OUT_OF_STOCK'))) AS items_to_restock,
          (SELECT COUNT(*) FROM reservations WHERE status = 'PENDING') AS pending_reservations,
          (SELECT COUNT(*) FROM reservations WHERE status IN ('PENDING', 'CONFIRMED', 'READY_FOR_PICKUP')) AS active_reservations,
          (SELECT COUNT(*) FROM receipts WHERE status = 'PENDING') AS receipts_to_verify,
          (SELECT COUNT(*) FROM conversations WHERE status = 'OPEN') AS open_conversations
      `,
      prisma.$queryRaw<DashboardProductRow[]>`
        SELECT
          p.id,
          p.category_id,
          p.name,
          p.description,
          p.image_url,
          p.price,
          p.old_price,
          p.status::text,
          p.stock,
          p.low_stock_threshold,
          p.is_active,
          c.name AS category_name,
          c.slug AS category_slug,
          c.icon_url AS category_icon_url,
          c.is_active AS category_is_active
        FROM products p
        JOIN categories c ON c.id = p.category_id
        WHERE p.is_active = true
        ORDER BY
          CASE
            WHEN p.stock <= 0 OR p.status = 'OUT_OF_STOCK' THEN 0
            WHEN p.stock <= p.low_stock_threshold OR p.status = 'RESTOCK_SOON' THEN 1
            WHEN p.status = 'ON_SALE' THEN 2
            ELSE 3
          END,
          p.name ASC
        LIMIT 5
      `,
      prisma.reservation.findMany({
        where: { status: { in: ["PENDING", "CONFIRMED", "READY_FOR_PICKUP"] } },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          studentId: true,
          referenceCode: true,
          status: true,
          pickupStart: true,
          pickupEnd: true,
          paymentMethod: true,
          totalAmount: true,
          staffNotes: true,
          createdAt: true,
          updatedAt: true,
          student: { select: { id: true, fullName: true, email: true, studentNumber: true } }
        }
      }),
      prisma.receipt.findMany({
        where: { status: "PENDING" },
        orderBy: { issuedAt: "desc" },
        take: 5,
        select: {
          id: true,
          receiptCode: true,
          studentId: true,
          reservationId: true,
          totalAmount: true,
          paymentMethod: true,
          status: true,
          verificationHash: true,
          receiptImageUrl: true,
          receiptPdfUrl: true,
          issuedById: true,
          issuedAt: true,
          createdAt: true,
          updatedAt: true
        }
      })
    ])
  );

  const metrics = countRows[0];
  return {
    metrics: {
      totalProducts: count(metrics?.total_products),
      itemsToRestock: count(metrics?.items_to_restock),
      pendingReservations: count(metrics?.pending_reservations),
      activeReservations: count(metrics?.active_reservations),
      receiptsToVerify: count(metrics?.receipts_to_verify),
      openConversations: count(metrics?.open_conversations)
    },
    products: productRows.map((product) => ({
      id: product.id,
      categoryId: product.category_id,
      name: product.name,
      description: product.description,
      imageUrl: product.image_url,
      price: String(product.price ?? 0),
      oldPrice: product.old_price == null ? null : String(product.old_price),
      status: product.status,
      stock: product.stock,
      lowStockThreshold: product.low_stock_threshold,
      isActive: product.is_active,
      category: {
        id: product.category_id,
        name: product.category_name,
        slug: product.category_slug,
        iconUrl: product.category_icon_url,
        isActive: product.category_is_active
      },
      variants: []
    })),
    reservations: reservations.map((reservation) => ({
      ...reservation,
      totalAmount: String(reservation.totalAmount),
      pickupStart: reservation.pickupStart?.toISOString() ?? null,
      pickupEnd: reservation.pickupEnd?.toISOString() ?? null,
      createdAt: reservation.createdAt.toISOString(),
      updatedAt: reservation.updatedAt.toISOString(),
      items: []
    })),
    receipts: receipts.map((receipt) => ({
      ...receipt,
      totalAmount: String(receipt.totalAmount),
      issuedAt: receipt.issuedAt.toISOString(),
      createdAt: receipt.createdAt.toISOString(),
      updatedAt: receipt.updatedAt.toISOString()
    }))
  };
}
