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
  return value.toISOString().slice(0, 10);
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

export async function getReportSummary() {
  const today = new Date();
  const trendStart = subDays(today, 6);

  const [
    products,
    reservationGroups,
    receiptAggregate,
    pendingReceiptCount,
    userGroups,
    activeConversations,
    recentReceipts
  ] = await withTransientPrismaReadRetry(() => prisma.$transaction([
    prisma.product.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        price: true,
        stock: true,
        lowStockThreshold: true,
        category: { select: { name: true } }
      }
    }),
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
    prisma.receipt.findMany({
      where: {
        status: { not: "VOIDED" },
        issuedAt: { gte: trendStart }
      },
      select: {
        totalAmount: true,
        issuedAt: true,
        reservation: {
          select: {
            items: {
              select: {
                subtotal: true,
                product: {
                  select: {
                    category: { select: { name: true } }
                  }
                }
              }
            }
          }
        }
      }
    })
  ]));

  const totalProducts = products.length;
  const lowStockItems = products.filter((product) => product.stock <= product.lowStockThreshold).length;
  const outOfStockItems = products.filter((product) => product.stock <= 0).length;
  const inventoryValue = products.reduce((sum, product) => sum + toNumber(product.price) * product.stock, 0);
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
  const categorySales = new Map<string, number>();

  recentReceipts.forEach((receipt) => {
    const trend = trendByDay.get(dayKey(receipt.issuedAt));
    if (trend) {
      trend.sales += toNumber(receipt.totalAmount);
      trend.receipts += 1;
    }

    receipt.reservation?.items.forEach((item) => {
      const category = item.product.category.name;
      categorySales.set(category, (categorySales.get(category) ?? 0) + toNumber(item.subtotal));
    });
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
    categorySales: Array.from(categorySales.entries())
      .map(([category, amount]) => ({ category, amount }))
      .sort((left, right) => right.amount - left.amount)
      .slice(0, 6),
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
