import type { ProductStatus } from "../types/app.js";

export type ProductAvailabilityState = {
  stock: number;
  status: ProductStatus;
  isActive: boolean;
  optionGroupsAvailable?: boolean;
};

export function isProductAvailable(state: ProductAvailabilityState) {
  return state.isActive
    && state.stock > 0
    && state.status !== "OUT_OF_STOCK"
    && state.optionGroupsAvailable !== false;
}

export function isBackInStockTransition(
  previous: ProductAvailabilityState,
  next: ProductAvailabilityState
) {
  return !isProductAvailable(previous) && isProductAvailable(next);
}

export function backInStockDedupeKey(eventId: string, userId: string) {
  return `back-in-stock:${eventId}:${userId}`;
}
