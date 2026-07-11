import type { CreateReservationPayload } from "@/lib/api";

export type PendingReservationRequest = {
  fingerprint: string;
  key: string;
};

function createRequestKey() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function requestFingerprint(payload: CreateReservationPayload) {
  return JSON.stringify({
    paymentMethod: payload.paymentMethod,
    pickupStart: payload.pickupStart ?? null,
    pickupEnd: payload.pickupEnd ?? null,
    items: [...payload.items]
      .map((item) => ({
        productId: item.productId,
        variantSummary: item.variantSummary?.trim() ?? "",
        quantity: item.quantity
      }))
      .sort((left, right) => `${left.productId}:${left.variantSummary}:${left.quantity}`.localeCompare(`${right.productId}:${right.variantSummary}:${right.quantity}`))
  });
}

export function getReservationRequestIdentity(
  payload: CreateReservationPayload,
  current: PendingReservationRequest | null
) {
  const fingerprint = requestFingerprint(payload);
  if (current?.fingerprint === fingerprint) return current;
  return { fingerprint, key: createRequestKey() };
}
