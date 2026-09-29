import type { BackendReportSummary } from "@/lib/api";

const emptyComparison = { current: 0, previous: 0, difference: 0, percentChange: null } as const;

export const EMPTY_REPORT_SUMMARY: BackendReportSummary = {
  generatedAt: "",
  range: { preset: "LAST_30_DAYS", from: null, to: "", granularity: "DAILY", label: "Last 30 Days" },
  filters: { collectionChannel: "ALL", categoryId: null, basis: "COLLECTION" },
  reportBasis: "COLLECTION",
  cashOnlyPolicy: { effectiveAt: "2026-09-27T16:00:00.000Z", enabled: true },
  totalSales: 0,
  cogs: 0,
  grossProfit: 0,
  commissaryCollection: 0,
  treasurerCollection: 0,
  collectionChannelBreakdown: { commissary: { amount: 0, payments: 0 }, treasurer: { amount: 0, payments: 0 } },
  commissaryPaymentBreakdown: { cash: { amount: 0, payments: 0 }, gcash: { amount: 0, payments: 0 }, other: { amount: 0, payments: 0 } },
  treasurerCollections: [],
  uncostedQuantity: 0,
  unverifiedInventoryQuantity: 0,
  cashRevenue: 0,
  commissaryCashRevenue: 0,
  treasuryCashRevenue: 0,
  inPersonRevenue: 0,
  legacyOnlineRevenue: 0,
  legacyInPersonRevenue: 0,
  paymentMethodBreakdown: {
    cash: { amount: 0, receipts: 0 },
    inPerson: { amount: 0, receipts: 0 },
    legacyOnline: { amount: 0, receipts: 0 },
    legacyInPerson: { amount: 0, receipts: 0 }
  },
  cashCollectionChannelBreakdown: {
    commissary: { amount: 0, payments: 0 },
    treasurer: { amount: 0, payments: 0 }
  },
  totalReservations: 0,
  pendingReservations: 0,
  lowStockItems: 0,
  outOfStockItems: 0,
  totalProducts: 0,
  inventoryValue: 0,
  activeUsers: 0,
  roleCounts: { students: 0, staff: 0, admins: 0 },
  receiptsToVerify: 0,
  totalReceipts: 0,
  activeConversations: 0,
  comparison: {
    available: false,
    label: null,
    cashRevenue: { ...emptyComparison },
    recognizedSales: { ...emptyComparison },
    grossProfit: { ...emptyComparison },
    reservations: { ...emptyComparison }
  },
  reconciliation: {
    status: "CLEAN",
    exceptionCount: 0,
    amountAtRisk: 0,
    truncated: false,
    counts: {},
    items: []
  },
  salesTrend: [],
  collectionTrend: [],
  categorySales: [],
  itemSales: [],
  inventoryPlanning: [],
  reservationStatusDistribution: [],
  inventoryInsights: []
};
