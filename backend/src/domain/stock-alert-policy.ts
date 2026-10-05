import { HttpError } from "../utils/http-error.js";

export const DEFAULT_LOW_STOCK_PERCENT = 25;

export function requireLowStockPercent(value: number | undefined, fallback = DEFAULT_LOW_STOCK_PERCENT) {
  const percent = value ?? fallback;
  if (!Number.isSafeInteger(percent) || percent < 1 || percent > 100) {
    throw new HttpError(400, "Low-stock percentage must be a whole number from 1 to 100.", "INVALID_LOW_STOCK_PERCENT");
  }
  return percent;
}

export function calculateLowStockThreshold(stockTarget: number, lowStockPercent: number) {
  if (!Number.isSafeInteger(stockTarget) || stockTarget < 0 || stockTarget > 10_000_000) {
    throw new HttpError(400, "Stock target must be a whole number from 0 to 10,000,000.", "INVALID_STOCK_TARGET");
  }
  const percent = requireLowStockPercent(lowStockPercent);
  return stockTarget === 0 ? 0 : Math.ceil(stockTarget * percent / 100);
}

export function nextStockAlertPolicy(input: {
  previousTarget: number;
  resultingStock: number;
  lowStockPercent?: number;
  previousPercent?: number;
}) {
  const lowStockPercent = requireLowStockPercent(input.lowStockPercent, input.previousPercent);
  const stockTarget = Math.max(input.previousTarget, input.resultingStock);
  return {
    stockTarget,
    lowStockPercent,
    lowStockThreshold: calculateLowStockThreshold(stockTarget, lowStockPercent)
  };
}
