import { createHash } from "node:crypto";

export const RESERVATION_IDEMPOTENCY_TTL_HOURS = 24;

type ReservationRequestForHash = {
  paymentMethod: string;
  pickupStart?: Date;
  pickupEnd?: Date;
  items: Array<{
    productId: string;
    skuId?: string;
    variantSummary?: string;
    quantity: number;
  }>;
};

function canonicalItems(items: ReservationRequestForHash["items"]) {
  return items
    .map((item) => ({
      productId: item.productId,
      skuId: item.skuId ?? "",
      variantSummary: item.variantSummary?.trim() ?? "",
      quantity: item.quantity
    }))
    .sort((left, right) => {
      const leftKey = `${left.productId}\u0000${left.skuId}\u0000${left.variantSummary}\u0000${left.quantity}`;
      const rightKey = `${right.productId}\u0000${right.skuId}\u0000${right.variantSummary}\u0000${right.quantity}`;
      return leftKey.localeCompare(rightKey);
    });
}

export function hashReservationRequest(input: ReservationRequestForHash) {
  const canonicalRequest = JSON.stringify({
    paymentMethod: input.paymentMethod,
    pickupStart: input.pickupStart?.toISOString() ?? null,
    pickupEnd: input.pickupEnd?.toISOString() ?? null,
    items: canonicalItems(input.items)
  });

  return createHash("sha256").update(canonicalRequest).digest("hex");
}

export function reservationIdempotencyExpiry(now = new Date()) {
  return new Date(now.getTime() + RESERVATION_IDEMPOTENCY_TTL_HOURS * 60 * 60 * 1000);
}
