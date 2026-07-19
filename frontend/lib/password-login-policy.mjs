export const TEMPORARY_PRODUCTION_STAFF_EMAIL = "staff@wesleyan.edu.ph";
export const MAX_TEMPORARY_STAFF_LOGIN_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEVELOPMENT_TEST_ACCOUNT_EMAILS = new Set([
  "admin@wesleyan.edu.ph",
  "staff@wesleyan.edu.ph",
  "student@wesleyan.edu.ph"
]);

/** @param {string | undefined} value */
export function temporaryStaffLoginExpirationTimestamp(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    return Number.NaN;
  }
  return Date.parse(value);
}

/**
 * @param {{ email: string; enabled: boolean; expiresAt?: string; nowMs?: number }} input
 */
export function isTemporaryProductionStaffPasswordLoginAvailable(input) {
  if (!input.enabled || input.email.trim().toLowerCase() !== TEMPORARY_PRODUCTION_STAFF_EMAIL) {
    return false;
  }

  const expiresAtMs = temporaryStaffLoginExpirationTimestamp(input.expiresAt);
  const nowMs = input.nowMs ?? Date.now();
  return Number.isFinite(expiresAtMs) && expiresAtMs > nowMs;
}

/**
 * @param {{
 *   email: string;
 *   developmentEnabled: boolean;
 *   temporaryStaffEnabled: boolean;
 *   temporaryStaffExpiresAt?: string;
 *   nowMs?: number;
 * }} input
 * @returns {"dev-login" | "temporary-staff-login" | null}
 */
export function passwordLoginTarget(input) {
  const normalizedEmail = input.email.trim().toLowerCase();
  if (isTemporaryProductionStaffPasswordLoginAvailable({
    email: normalizedEmail,
    enabled: input.temporaryStaffEnabled,
    expiresAt: input.temporaryStaffExpiresAt,
    nowMs: input.nowMs
  })) {
    return "temporary-staff-login";
  }
  if (input.developmentEnabled && DEVELOPMENT_TEST_ACCOUNT_EMAILS.has(normalizedEmail)) {
    return "dev-login";
  }
  return null;
}
