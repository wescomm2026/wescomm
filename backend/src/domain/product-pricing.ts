import type { ProductStatus } from "../types/app.js";

type MoneyValue = number | string | { toString(): string } | null | undefined;

function numericMoney(value: MoneyValue) {
  if (value === null || value === undefined) return null;
  const numeric = Number(value.toString());
  return Number.isFinite(numeric) ? numeric : null;
}

/** A product is on sale only when it has a real markdown from oldPrice to price. */
export function isProductOnSale(price: MoneyValue, oldPrice: MoneyValue) {
  const current = numericMoney(price);
  const previous = numericMoney(oldPrice);
  return current !== null && previous !== null && previous > current;
}

export function availabilityStatus(
  stock: number,
  lowStockThreshold: number,
  persistedStatus: ProductStatus
): Exclude<ProductStatus, "ON_SALE"> {
  if (stock <= 0) return "OUT_OF_STOCK";
  if (stock <= lowStockThreshold) return "RESTOCK_SOON";
  return persistedStatus === "OUT_OF_STOCK" || persistedStatus === "RESTOCK_SOON" || persistedStatus === "ON_SALE"
    ? "IN_STOCK"
    : persistedStatus;
}
