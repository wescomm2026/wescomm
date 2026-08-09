import type { BackendPaymentSummary } from "@/lib/api";

const PAYMONGO_CHECKOUT_HOST = "checkout.paymongo.com";
const PAYMENT_REQUEST_KEY_PREFIX = "wescomm_paymongo_request:v1";
const PAYMENT_CHECKOUT_KEY_PREFIX = "wescomm_paymongo_checkout:v1";
const PAYMENT_STORAGE_TTL_MS = 24 * 60 * 60 * 1000;

type StoredPaymentRequest = {
  key: string;
  createdAt: number;
};

type StoredCheckout = {
  reservationId: string;
  checkoutUrl: string;
  createdAt: number;
};

function removeStoredValue(key: string) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Browser privacy settings can make storage unavailable even for removal.
  }
}

function createRequestKey() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function readStoredValue<T>(key: string): T | null {
  if (typeof window === "undefined") return null;

  try {
    const rawValue = window.sessionStorage.getItem(key);
    return rawValue ? JSON.parse(rawValue) as T : null;
  } catch {
    removeStoredValue(key);
    return null;
  }
}

function writeStoredValue(key: string, value: unknown) {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A payment can still continue when browser storage is unavailable.
  }
}

export function isTrustedPaymongoCheckoutUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname === PAYMONGO_CHECKOUT_HOST
      && url.port === ""
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}

export function getPaymentIdempotencyKey(reservationId: string, { renew = false } = {}) {
  const storageKey = `${PAYMENT_REQUEST_KEY_PREFIX}:${reservationId}`;
  const stored = readStoredValue<StoredPaymentRequest>(storageKey);
  const storedIsCurrent = stored
    && typeof stored.key === "string"
    && Number.isFinite(stored.createdAt)
    && Date.now() - stored.createdAt < PAYMENT_STORAGE_TTL_MS;

  if (!renew && storedIsCurrent) return stored.key;

  const next = { key: createRequestKey(), createdAt: Date.now() };
  writeStoredValue(storageKey, next);
  return next.key;
}

export function rememberPaymentCheckout(payment: BackendPaymentSummary, checkoutUrl: string) {
  if (!isTrustedPaymongoCheckoutUrl(checkoutUrl)) return false;

  writeStoredValue(`${PAYMENT_CHECKOUT_KEY_PREFIX}:${payment.id}`, {
    reservationId: payment.reservationId,
    checkoutUrl,
    createdAt: Date.now()
  } satisfies StoredCheckout);
  return true;
}

export function getRememberedPaymentCheckout(paymentId: string, reservationId: string) {
  const storageKey = `${PAYMENT_CHECKOUT_KEY_PREFIX}:${paymentId}`;
  const stored = readStoredValue<StoredCheckout>(storageKey);
  const isCurrent = stored
    && stored.reservationId === reservationId
    && Number.isFinite(stored.createdAt)
    && Date.now() - stored.createdAt < PAYMENT_STORAGE_TTL_MS
    && isTrustedPaymongoCheckoutUrl(stored.checkoutUrl);

  if (isCurrent) return stored.checkoutUrl;
  removeStoredValue(storageKey);
  return null;
}

export function openTrustedPaymongoCheckout(checkoutUrl: string) {
  if (!isTrustedPaymongoCheckoutUrl(checkoutUrl)) {
    throw new Error("WESCOMM blocked an invalid payment destination. Please try again.");
  }
  window.location.assign(checkoutUrl);
}
