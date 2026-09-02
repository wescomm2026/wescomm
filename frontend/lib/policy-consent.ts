export const ACCOUNT_POLICY_VERSION = "2026-09-02";
export const CHECKOUT_POLICY_VERSION = "2026-09-02";

export type PolicyAcceptancePayload = {
  accepted: true;
  version: string;
};

type PendingAccountPolicyAcceptance = {
  email: string;
  version: string;
  recordedAt: number;
};

const PENDING_ACCOUNT_ACCEPTANCE_KEY = "wescomm_pending_policy_acceptance:v1";
const PENDING_ACCOUNT_ACCEPTANCE_TTL_MS = 24 * 60 * 60 * 1000;

export function currentAccountPolicyAcceptance(): PolicyAcceptancePayload {
  return { accepted: true, version: ACCOUNT_POLICY_VERSION };
}

export function currentCheckoutPolicyAcceptance(): PolicyAcceptancePayload {
  return { accepted: true, version: CHECKOUT_POLICY_VERSION };
}

export function rememberPendingAccountPolicyAcceptance(email: string) {
  if (typeof window === "undefined") return;
  const pending: PendingAccountPolicyAcceptance = {
    email: email.trim().toLowerCase(),
    version: ACCOUNT_POLICY_VERSION,
    recordedAt: Date.now()
  };
  try {
    window.localStorage.setItem(PENDING_ACCOUNT_ACCEPTANCE_KEY, JSON.stringify(pending));
  } catch {
    // The OTP form still carries the accepted version for same-page verification.
  }
}

export function readPendingAccountPolicyAcceptance(email: string) {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PENDING_ACCOUNT_ACCEPTANCE_KEY);
    if (!raw) return null;
    const pending = JSON.parse(raw) as Partial<PendingAccountPolicyAcceptance>;
    const valid = pending.email === email.trim().toLowerCase()
      && pending.version === ACCOUNT_POLICY_VERSION
      && typeof pending.recordedAt === "number"
      && Date.now() - pending.recordedAt < PENDING_ACCOUNT_ACCEPTANCE_TTL_MS;
    if (!valid) {
      window.localStorage.removeItem(PENDING_ACCOUNT_ACCEPTANCE_KEY);
      return null;
    }
    return currentAccountPolicyAcceptance();
  } catch {
    return null;
  }
}

export function clearPendingAccountPolicyAcceptance() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(PENDING_ACCOUNT_ACCEPTANCE_KEY);
  } catch {
    // Browser privacy settings can make storage unavailable even for removal.
  }
}
