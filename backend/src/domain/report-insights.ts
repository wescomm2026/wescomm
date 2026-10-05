export const REPORT_BASES = ["COLLECTION", "COMPLETION"] as const;
export type ReportBasis = (typeof REPORT_BASES)[number];

export type ReportComparisonMetric = {
  current: number;
  previous: number;
  difference: number;
  percentChange: number | null;
};

export function buildReportComparisonMetric(current: number, previous: number): ReportComparisonMetric {
  return {
    current,
    previous,
    difference: current - previous,
    percentChange: previous === 0 ? null : Math.round(((current - previous) / previous) * 1_000) / 10
  };
}

export type InventoryPlanningStatus = "OUT_OF_STOCK" | "REORDER" | "NO_SALES" | "SLOW_MOVING" | "HEALTHY";

export function buildInventoryPlanning(input: {
  stock: number;
  lowStockThreshold: number;
  unitsSold: number;
  sales: number;
  cogs: number;
  observationDays: number;
}) {
  const grossProfit = input.sales - input.cogs;
  const marginPercent = input.sales > 0 ? Math.round((grossProfit / input.sales) * 1_000) / 10 : null;
  const stockCoverDays = input.unitsSold > 0
    ? Math.round((input.stock / (input.unitsSold / Math.max(1, input.observationDays))) * 10) / 10
    : null;
  const suggestedReorderQuantity = Math.max(0, input.lowStockThreshold * 2 - input.stock);
  let status: InventoryPlanningStatus = "HEALTHY";
  let recommendation = "Maintain current stock and monitor demand.";

  if (input.stock <= 0) {
    status = "OUT_OF_STOCK";
    recommendation = `Restock at least ${Math.max(input.lowStockThreshold * 2, 1)} unit(s).`;
  } else if (input.stock <= input.lowStockThreshold) {
    status = "REORDER";
    recommendation = `Restock about ${suggestedReorderQuantity || input.lowStockThreshold} unit(s).`;
  } else if (input.unitsSold === 0) {
    status = "NO_SALES";
    recommendation = "Review demand before buying more stock.";
  } else if (stockCoverDays !== null && stockCoverDays > 90) {
    status = "SLOW_MOVING";
    recommendation = "Pause restocking and review pricing or demand.";
  }

  return { grossProfit, marginPercent, stockCoverDays, suggestedReorderQuantity, status, recommendation };
}

export const REPORT_RECONCILIATION_TYPES = [
  "MISSING_TREASURY_OR",
  "PAYMENT_RECEIPT_MISMATCH",
  "COMPLETED_WITHOUT_PAID_PAYMENT",
  "COMPLETED_WITHOUT_VERIFIED_RECEIPT",
  "PAID_NOT_COMPLETED",
  "POST_CUTOVER_NON_CASH"
] as const;

export type ReportReconciliationType = (typeof REPORT_RECONCILIATION_TYPES)[number];

export function reconciliationLabel(type: ReportReconciliationType) {
  const labels: Record<ReportReconciliationType, string> = {
    MISSING_TREASURY_OR: "Treasury payment has no OR number",
    PAYMENT_RECEIPT_MISMATCH: "Payment and receipt amounts do not match",
    COMPLETED_WITHOUT_PAID_PAYMENT: "Completed reservation has no paid payment",
    COMPLETED_WITHOUT_VERIFIED_RECEIPT: "Completed reservation has no verified receipt",
    PAID_NOT_COMPLETED: "Paid reservation is not completed",
    POST_CUTOVER_NON_CASH: "Non-cash payment recorded after cash-only cutoff"
  };
  return labels[type];
}
