import type { Prisma } from "@prisma/client";
import {
  MAX_SALES_LEDGER_RECEIPTS,
  resolveSalesLedgerRange,
  SALES_REPORT_TIMEZONE,
  type ResolvedSalesLedgerRange,
  type SalesReportChannel,
  type SalesReportLocation,
  type SalesReportPeriod
} from "../domain/sales-ledger.js";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../utils/http-error.js";

export type SalesLedgerInput = {
  period: SalesReportPeriod;
  anchor: string;
  channel: SalesReportChannel;
  collectionLocation: SalesReportLocation;
  snapshotAt?: Date | string;
  now?: Date | string;
};

export type SalesLedgerFilters = {
  channel: SalesReportChannel;
  collectionLocation: SalesReportLocation;
};

export type SalesLedgerItem = {
  productId: string;
  productName: string;
  skuCode: string | null;
  variant: string | null;
  category: string | null;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  cogs: number;
};

export type SalesLedgerSaleRow = {
  sequence: number;
  timestamp: string;
  receiptCode: string;
  type: "RESERVATION" | "WALK_IN";
  studentName: string;
  studentNumber: string | null;
  orderReference: string | null;
  items: SalesLedgerItem[];
  itemLines: string[];
  quantity: number;
  collectionPoint: "COMMISSARY" | "TREASURER";
  cashierName: string | null;
  amount: number;
};

export type SalesLedgerVoidRow = {
  voidedAt: string;
  originalSaleAt: string | null;
  receiptCode: string;
  type: "RESERVATION" | "WALK_IN";
  amount: number;
  cashierName: string | null;
  voidedBy: string | null;
  reason: string | null;
};

export type SalesLedgerProductSummaryRow = {
  item: string;
  category: string | null;
  skuOrOption: string | null;
  quantity: number;
  sales: number;
  cogs: number;
  grossProfit: number;
};

export type SalesLedgerReport = {
  generatedAt: string;
  generatedBy: string | null;
  range: {
    period: SalesReportPeriod;
    anchor: string;
    fromKey: string;
    toKey: string;
    fromInclusive: string;
    toExclusive: string;
    label: string;
  };
  filters: SalesLedgerFilters;
  summary: {
    validSalesTransactions: number;
    totalUnitsSold: number;
    reservationSales: { count: number; amount: number };
    walkInSales: { count: number; amount: number };
    totalRecognizedSales: number;
    voidsProcessed: { count: number; amount: number };
  };
  sales: SalesLedgerSaleRow[];
  voids: SalesLedgerVoidRow[];
  productSummary: SalesLedgerProductSummaryRow[];
};

type OptionSnapshotValue = { optionName?: string; optionValue?: string };

function toNumber(value: unknown) {
  const numericValue = Number(value ?? 0);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function optionDisplay(options: unknown) {
  if (!Array.isArray(options)) return null;
  const values = options
    .map((option) => (option as OptionSnapshotValue | null)?.optionValue ?? "")
    .filter(Boolean);
  return values.length ? values.join(", ") : null;
}

function itemVariant(item: { variantSummary?: string | null; optionSnapshot?: unknown }) {
  const summary = item.variantSummary?.trim();
  if (summary) return summary;
  return optionDisplay(item.optionSnapshot);
}

function formatItemLine(item: { productName: string; variant: string | null; quantity: number }) {
  return `${item.quantity}\u00d7 ${item.productName}${item.variant ? ` \u2014 ${item.variant}` : ""}`;
}

type ReceiptWithSalesData = Prisma.ReceiptGetPayload<{
  include: typeof receiptInclude;
}>;

const receiptInclude = {
  student: { select: { fullName: true, studentNumber: true } },
  issuedBy: { select: { fullName: true } },
  reservation: {
    select: {
      referenceCode: true,
      collectionPayment: { select: { paidAt: true, collectionChannel: true } },
      items: {
        select: {
          productId: true,
          productNameSnapshot: true,
          skuCodeSnapshot: true,
          optionSnapshot: true,
          variantSummary: true,
          categoryNameSnapshot: true,
          quantity: true,
          unitPrice: true,
          subtotal: true,
          costAllocations: {
            select: {
              quantity: true,
              unitCost: true
            }
          }
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }]
      }
    }
  },
  walkInSale: { select: { cashierNameSnapshot: true, buyerNameSnapshot: true } },
  walkInSaleItems: {
    select: {
      productId: true,
      productNameSnapshot: true,
      optionSnapshot: true,
      quantity: true,
      unitPrice: true,
      subtotal: true,
      costAllocations: {
        select: {
          quantity: true,
          unitCost: true
        }
      }
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }]
  }
} satisfies Prisma.ReceiptInclude;

function buildSalesBranches(
  range: ResolvedSalesLedgerRange,
  filters: SalesLedgerFilters,
  snapshotAt: Date
): Prisma.ReceiptWhereInput[] {
  const branches: Prisma.ReceiptWhereInput[] = [];
  const salesUpperBound = snapshotAt < range.toExclusive ? snapshotAt : range.toExclusive;
  const includeReservation = filters.channel !== "WALK_IN";
  const includeWalkIn = filters.channel !== "RESERVATION" && filters.collectionLocation !== "TREASURER";

  if (includeReservation) {
    const reservationBranch: Prisma.ReceiptWhereInput = {
      reservationId: { not: null },
      walkInSale: null,
      reservation: {
        status: "COMPLETED",
        collectionPayment: {
          paidAt: { gte: range.fromInclusive, lt: salesUpperBound },
          OR: [
            { status: "PAID", voidedAt: null },
            { status: "VOIDED", voidedAt: { gt: snapshotAt } }
          ],
          ...(filters.collectionLocation === "ALL"
            ? {}
            : { collectionChannel: filters.collectionLocation })
        }
      }
    };
    branches.push(reservationBranch);
  }

  if (includeWalkIn) {
    const walkInBranch: Prisma.ReceiptWhereInput = {
      reservationId: null,
      walkInSale: {
        OR: [
          { voidedAt: null },
          { voidedAt: { gt: snapshotAt } }
        ]
      },
      issuedAt: { gte: range.fromInclusive, lt: salesUpperBound }
    };
    branches.push(walkInBranch);
  }

  return branches;
}

type CostAllocationLike = {
  quantity: number;
  unitCost: Prisma.Decimal | number | null;
};

function allocatedCogs(allocations: CostAllocationLike[]) {
  return allocations.reduce((total, allocation) => {
    return total + toNumber(allocation.unitCost) * allocation.quantity;
  }, 0);
}

export function mapSaleRows(receipts: ReceiptWithSalesData[]): SalesLedgerSaleRow[] {
  const rows = receipts.map((receipt) => {
    const isWalkIn = Boolean(receipt.walkInSale);
    const timestamp = isWalkIn
      ? receipt.issuedAt
      : receipt.reservation?.collectionPayment?.paidAt ?? receipt.verifiedAt ?? receipt.issuedAt;
    const items: SalesLedgerItem[] = isWalkIn
      ? receipt.walkInSaleItems.map((item) => ({
          productId: item.productId,
          productName: item.productNameSnapshot,
          skuCode: null,
          variant: optionDisplay(item.optionSnapshot),
          category: null,
          quantity: item.quantity,
          unitPrice: toNumber(item.unitPrice),
          subtotal: toNumber(item.subtotal),
          cogs: allocatedCogs(item.costAllocations)
        }))
      : (receipt.reservation?.items ?? []).map((item) => ({
          productId: item.productId,
          productName: item.productNameSnapshot,
          skuCode: item.skuCodeSnapshot,
          variant: itemVariant(item),
          category: item.categoryNameSnapshot,
          quantity: item.quantity,
          unitPrice: toNumber(item.unitPrice),
          subtotal: toNumber(item.subtotal),
          cogs: allocatedCogs(item.costAllocations)
        }));

    return {
      timestamp: timestamp.toISOString(),
      receiptCode: receipt.receiptCode,
      type: isWalkIn ? ("WALK_IN" as const) : ("RESERVATION" as const),
      studentName: isWalkIn
        ? receipt.walkInSale?.buyerNameSnapshot ?? receipt.student?.fullName ?? "Walk-in buyer"
        : receipt.student?.fullName || "Unknown student",
      studentNumber: receipt.student?.studentNumber ?? null,
      orderReference: isWalkIn ? null : receipt.reservation?.referenceCode ?? null,
      items,
      itemLines: items.map((item) => formatItemLine(item)),
      quantity: items.reduce((total, item) => total + item.quantity, 0),
      collectionPoint: isWalkIn
        ? ("COMMISSARY" as const)
        : receipt.reservation?.collectionPayment?.collectionChannel ?? "COMMISSARY",
      cashierName: isWalkIn ? receipt.walkInSale?.cashierNameSnapshot ?? null : receipt.issuedBy?.fullName ?? null,
      amount: toNumber(receipt.totalAmount)
    };
  });

  rows.sort((left, right) => {
    const byTimestamp = left.timestamp.localeCompare(right.timestamp);
    return byTimestamp !== 0 ? byTimestamp : left.receiptCode.localeCompare(right.receiptCode);
  });

  return rows.map((row, index) => ({ ...row, sequence: index + 1 }));
}

export function buildProductSummary(sales: SalesLedgerSaleRow[]): SalesLedgerProductSummaryRow[] {
  const groups = new Map<string, SalesLedgerProductSummaryRow>();
  for (const sale of sales) {
    for (const item of sale.items) {
      const key = `${item.productId}\u0000${item.variant ?? ""}\u0000${item.skuCode ?? ""}`;
      const current = groups.get(key) ?? {
        item: item.productName,
        category: item.category,
        skuOrOption: item.skuCode ? `${item.skuCode}${item.variant ? ` \u2014 ${item.variant}` : ""}` : item.variant,
        quantity: 0,
        sales: 0,
        cogs: 0,
        grossProfit: 0
      };
      current.quantity += item.quantity;
      current.sales += item.subtotal;
      current.cogs += item.cogs;
      current.grossProfit = current.sales - current.cogs;
      groups.set(key, current);
    }
  }
  return Array.from(groups.values()).sort((left, right) => right.sales - left.sales);
}

export function buildSummary(sales: SalesLedgerSaleRow[], voids: SalesLedgerVoidRow[]) {
  const reservationRows = sales.filter((row) => row.type === "RESERVATION");
  const walkInRows = sales.filter((row) => row.type === "WALK_IN");
  const reservationAmount = reservationRows.reduce((total, row) => total + row.amount, 0);
  const walkInAmount = walkInRows.reduce((total, row) => total + row.amount, 0);
  const voidAmount = voids.reduce((total, row) => total + row.amount, 0);

  return {
    validSalesTransactions: sales.length,
    totalUnitsSold: sales.reduce((total, row) => total + row.quantity, 0),
    reservationSales: { count: reservationRows.length, amount: reservationAmount },
    walkInSales: { count: walkInRows.length, amount: walkInAmount },
    totalRecognizedSales: reservationAmount + walkInAmount,
    voidsProcessed: { count: voids.length, amount: voidAmount }
  };
}

async function enrichWalkInCategories(sales: SalesLedgerSaleRow[]) {
  const walkInProductIds = [
    ...new Set(sales.flatMap((row) => row.type === "WALK_IN" ? row.items.map((item) => item.productId) : []))
  ];
  if (!walkInProductIds.length) return;
  const products = await prisma.product.findMany({
    where: { id: { in: walkInProductIds } },
    select: { id: true, category: { select: { name: true } } }
  });
  const categoryById = new Map(products.map((product) => [product.id, product.category.name]));
  for (const sale of sales) {
    if (sale.type !== "WALK_IN") continue;
    for (const item of sale.items) {
      item.category = categoryById.get(item.productId) ?? null;
    }
  }
}

async function loadVoids(
  range: ResolvedSalesLedgerRange,
  filters: SalesLedgerFilters,
  snapshotAt: Date
): Promise<SalesLedgerVoidRow[]> {
  const rows: SalesLedgerVoidRow[] = [];
  const voidUpperBound = snapshotAt < range.toExclusive ? snapshotAt : range.toExclusive;

  if (filters.channel !== "WALK_IN") {
    const payments = await prisma.payment.findMany({
      where: {
        voidedAt: { gte: range.fromInclusive, lt: voidUpperBound },
        ...(filters.collectionLocation === "ALL" ? {} : { collectionChannel: filters.collectionLocation })
      },
      select: {
        voidedAt: true,
        amount: true,
        paidAt: true,
        voidReason: true,
        voidedBy: { select: { fullName: true } },
        reservation: {
          select: {
            receipt: { select: { receiptCode: true, issuedBy: { select: { fullName: true } } } }
          }
        }
      },
      orderBy: [{ voidedAt: "asc" }, { id: "asc" }]
    });

    for (const payment of payments) {
      const receipt = payment.reservation?.receipt ?? null;
      rows.push({
        voidedAt: payment.voidedAt!.toISOString(),
        originalSaleAt: payment.paidAt.toISOString(),
        receiptCode: receipt?.receiptCode ?? "No receipt",
        type: "RESERVATION",
        amount: toNumber(payment.amount),
        cashierName: receipt?.issuedBy?.fullName ?? null,
        voidedBy: payment.voidedBy?.fullName ?? null,
        reason: payment.voidReason
      });
    }
  }

  if (filters.channel !== "RESERVATION" && filters.collectionLocation !== "TREASURER") {
    const walkIns = await prisma.walkInSale.findMany({
      where: { voidedAt: { gte: range.fromInclusive, lt: voidUpperBound } },
      select: {
        voidedAt: true,
        voidReason: true,
        cashierNameSnapshot: true,
        voidedById: true,
        receipt: { select: { receiptCode: true, totalAmount: true, issuedAt: true } }
      },
      orderBy: [{ voidedAt: "asc" }, { id: "asc" }]
    });

    const voiderIds = [...new Set(walkIns.map((walkIn) => walkIn.voidedById).filter((id): id is string => Boolean(id)))];
    const voiders = voiderIds.length
      ? await prisma.profile.findMany({
          where: { id: { in: voiderIds } },
          select: { id: true, fullName: true }
        })
      : [];
    const voiderNameById = new Map(voiders.map((profile) => [profile.id, profile.fullName]));

    for (const walkIn of walkIns) {
      rows.push({
        voidedAt: walkIn.voidedAt!.toISOString(),
        originalSaleAt: walkIn.receipt.issuedAt.toISOString(),
        receiptCode: walkIn.receipt.receiptCode,
        type: "WALK_IN",
        amount: toNumber(walkIn.receipt.totalAmount),
        cashierName: walkIn.cashierNameSnapshot,
        voidedBy: walkIn.voidedById ? voiderNameById.get(walkIn.voidedById) ?? null : null,
        reason: walkIn.voidReason
      });
    }
  }

  rows.sort((left, right) => {
    const byTimestamp = left.voidedAt.localeCompare(right.voidedAt);
    return byTimestamp !== 0 ? byTimestamp : left.receiptCode.localeCompare(right.receiptCode);
  });

  return rows;
}

export async function buildSalesLedgerReport(
  input: SalesLedgerInput,
  generatedBy: string | null = null
): Promise<SalesLedgerReport> {
  const range = resolveSalesLedgerRange(input);
  const snapshotAt = new Date(input.snapshotAt ?? new Date());
  if (!Number.isFinite(snapshotAt.getTime())) {
    throw new HttpError(400, "The report snapshot time is invalid.", "INVALID_REPORT_SNAPSHOT");
  }
  if (snapshotAt.getTime() > Date.now() + 60_000) {
    throw new HttpError(400, "The report snapshot time cannot be in the future.", "INVALID_REPORT_SNAPSHOT");
  }
  const filters: SalesLedgerFilters = {
    channel: input.channel,
    collectionLocation: input.collectionLocation
  };
  const branches = buildSalesBranches(range, filters, snapshotAt);

  const receipts = await prisma.receipt.findMany({
    where: {
      AND: [
        { OR: branches },
        { verifiedAt: { not: null, lte: snapshotAt } },
        {
          OR: [
            { status: "VERIFIED", voidedAt: null },
            { status: "VOIDED", voidedAt: { gt: snapshotAt } }
          ]
        }
      ]
    },
    include: receiptInclude,
    orderBy: [{ issuedAt: "asc" }, { receiptCode: "asc" }],
    take: MAX_SALES_LEDGER_RECEIPTS + 1
  });

  if (receipts.length > MAX_SALES_LEDGER_RECEIPTS) {
    throw new HttpError(
      422,
      `This period contains more than ${MAX_SALES_LEDGER_RECEIPTS.toLocaleString("en-PH")} sales transactions. Narrow the date range or split the report.`,
      "SALES_LEDGER_TOO_LARGE"
    );
  }

  const sales = mapSaleRows(receipts);
  const voids = await loadVoids(range, filters, snapshotAt);
  await enrichWalkInCategories(sales);

  return {
    generatedAt: snapshotAt.toISOString(),
    generatedBy,
    range: {
      period: range.period,
      anchor: range.anchor,
      fromKey: range.fromKey,
      toKey: range.toKey,
      fromInclusive: range.fromInclusive.toISOString(),
      toExclusive: range.toExclusive.toISOString(),
      label: range.label
    },
    filters,
    summary: buildSummary(sales, voids),
    sales,
    voids,
    productSummary: buildProductSummary(sales)
  };
}

export function salesLedgerReportTitle(period: SalesReportPeriod) {
  return ({
    DAILY: "Daily Sales Report",
    WEEKLY: "Weekly Sales Report",
    MONTHLY: "Monthly Sales Report"
  } as const)[period];
}

export function salesLedgerPeriodLabel(period: SalesReportPeriod) {
  return ({ DAILY: "Daily", WEEKLY: "Weekly", MONTHLY: "Monthly" } as const)[period];
}

export function salesLedgerChannelLabel(channel: SalesReportChannel) {
  return ({ ALL: "All", RESERVATION: "Reservation", WALK_IN: "Walk-in" } as const)[channel];
}

export function salesLedgerLocationLabel(location: SalesReportLocation) {
  return ({ ALL: "All locations", COMMISSARY: "Commissary", TREASURER: "Treasury" } as const)[location];
}

export function formatSalesLedgerDateTime(value: Date | string) {
  return new Date(value).toLocaleString("en-PH", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: SALES_REPORT_TIMEZONE
  });
}

export function formatSalesLedgerDate(value: Date | string) {
  return new Date(value).toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    timeZone: SALES_REPORT_TIMEZONE
  });
}
