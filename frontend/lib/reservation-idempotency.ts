import type { CreateReservationPayload } from "@/lib/api";

export type PendingReservationRequest = {
  fingerprint: string;
  key: string;
};

const RESERVATION_REQUEST_KEY_PREFIX = "wescomm_reservation_request:v3";
const RESERVATION_REQUEST_TTL_MS = 24 * 60 * 60 * 1000;

type StoredReservationRequest = PendingReservationRequest & {
  createdAt: number;
};

function createRequestKey() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function requestFingerprint(payload: CreateReservationPayload) {
  const canonicalPayload = JSON.stringify({
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

  const seeds = [2166136261, 2246822507, 3266489909, 668265263];
  const hashes = seeds.map((seed) => {
    let hash = seed;
    for (let index = 0; index < canonicalPayload.length; index += 1) {
      hash = Math.imul(hash ^ canonicalPayload.charCodeAt(index), 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  });
  return `${canonicalPayload.length.toString(16)}-${hashes.join("")}`;
}

function reservationStorageKey(ownerId: string, fingerprint: string) {
  return `${RESERVATION_REQUEST_KEY_PREFIX}:${encodeURIComponent(ownerId)}:${fingerprint}`;
}

function removeStoredRequest(storageKey: string) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(storageKey);
  } catch {
    // Browser privacy settings can make storage unavailable even for removal.
  }
}

function readStoredRequest(ownerId: string, fingerprint: string) {
  if (typeof window === "undefined" || !ownerId) return null;
  const storageKey = reservationStorageKey(ownerId, fingerprint);

  try {
    const rawValue = window.sessionStorage.getItem(storageKey);
    if (!rawValue) return null;
    const stored = JSON.parse(rawValue) as StoredReservationRequest;
    if (
      stored.fingerprint !== fingerprint
      || typeof stored.key !== "string"
      || !Number.isFinite(stored.createdAt)
      || Date.now() - stored.createdAt >= RESERVATION_REQUEST_TTL_MS
    ) {
      removeStoredRequest(storageKey);
      return null;
    }
    return { fingerprint: stored.fingerprint, key: stored.key };
  } catch {
    removeStoredRequest(storageKey);
    return null;
  }
}

function storeRequest(ownerId: string, request: PendingReservationRequest) {
  if (typeof window === "undefined" || !ownerId) return;
  try {
    window.sessionStorage.setItem(
      reservationStorageKey(ownerId, request.fingerprint),
      JSON.stringify({ ...request, createdAt: Date.now() } satisfies StoredReservationRequest)
    );
  } catch {
    // The in-memory identity still protects retries while the checkout remains open.
  }
}

export function getReservationRequestIdentity(
  payload: CreateReservationPayload,
  current: PendingReservationRequest | null,
  ownerId = ""
) {
  const fingerprint = requestFingerprint(payload);
  if (current?.fingerprint === fingerprint) return current;
  const stored = readStoredRequest(ownerId, fingerprint);
  if (stored) return stored;

  const request = { fingerprint, key: createRequestKey() };
  storeRequest(ownerId, request);
  return request;
}

export function clearReservationRequestIdentity(ownerId: string, request: PendingReservationRequest | null) {
  if (typeof window === "undefined" || !ownerId || !request) return;
  removeStoredRequest(reservationStorageKey(ownerId, request.fingerprint));
}
