import {
  isVerifiedVercelProductionEnvironment,
  type DeploymentEnvironment
} from "./deployment-environment.js";

export const TEMPORARY_PRODUCTION_STAFF_EMAIL = "staff@wesleyan.edu.ph";
export const MAX_TEMPORARY_STAFF_LOGIN_WINDOW_MS = 24 * 60 * 60 * 1000;
export const MAX_TEMPORARY_STAFF_SESSION_MS = 30 * 60 * 1000;

type TemporaryStaffLoginEnvironment = DeploymentEnvironment & {
  AUTH_ENABLE_TEMP_PRODUCTION_STAFF_LOGIN?: boolean;
  AUTH_TEMP_PRODUCTION_STAFF_LOGIN_PASSWORD?: string;
  AUTH_TEMP_PRODUCTION_STAFF_LOGIN_EXPIRES_AT?: string;
  NEXT_PUBLIC_ENABLE_TEMP_PRODUCTION_STAFF_LOGIN?: boolean;
  NEXT_PUBLIC_TEMP_PRODUCTION_STAFF_LOGIN_EXPIRES_AT?: string;
};

function expirationTimestamp(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    return Number.NaN;
  }
  return Date.parse(value);
}

export function assertSafeTemporaryStaffLoginEnvironment(
  environment: TemporaryStaffLoginEnvironment,
  nowMs = Date.now()
) {
  const backendEnabled = Boolean(environment.AUTH_ENABLE_TEMP_PRODUCTION_STAFF_LOGIN);
  const frontendEnabled = Boolean(environment.NEXT_PUBLIC_ENABLE_TEMP_PRODUCTION_STAFF_LOGIN);
  if (!backendEnabled && !frontendEnabled) return;

  if (!backendEnabled || !frontendEnabled) {
    throw new Error("Temporary Production staff login frontend and backend flags must be enabled together.");
  }
  if (!isVerifiedVercelProductionEnvironment(environment)) {
    throw new Error("Temporary Production staff login requires verified Vercel Production system variables.");
  }
  if ((environment.AUTH_TEMP_PRODUCTION_STAFF_LOGIN_PASSWORD?.trim().length ?? 0) < 20) {
    throw new Error("AUTH_TEMP_PRODUCTION_STAFF_LOGIN_PASSWORD must contain at least 20 characters.");
  }

  const backendExpiration = environment.AUTH_TEMP_PRODUCTION_STAFF_LOGIN_EXPIRES_AT?.trim();
  const frontendExpiration = environment.NEXT_PUBLIC_TEMP_PRODUCTION_STAFF_LOGIN_EXPIRES_AT?.trim();
  if (!backendExpiration || backendExpiration !== frontendExpiration) {
    throw new Error("Temporary Production staff login expiry values must be present and identical.");
  }

  const expiresAtMs = expirationTimestamp(backendExpiration);
  if (!Number.isFinite(expiresAtMs)) {
    throw new Error("Temporary Production staff login expiry must be a valid ISO-8601 timestamp.");
  }
  if (expiresAtMs - nowMs > MAX_TEMPORARY_STAFF_LOGIN_WINDOW_MS) {
    throw new Error("Temporary Production staff login cannot be enabled for more than 24 hours.");
  }
}

export function temporaryStaffLoginExpirationMs(
  environment: TemporaryStaffLoginEnvironment,
  nowMs = Date.now()
) {
  if (
    !environment.AUTH_ENABLE_TEMP_PRODUCTION_STAFF_LOGIN
    || !environment.NEXT_PUBLIC_ENABLE_TEMP_PRODUCTION_STAFF_LOGIN
    || !isVerifiedVercelProductionEnvironment(environment)
  ) {
    return null;
  }

  const backendExpiration = environment.AUTH_TEMP_PRODUCTION_STAFF_LOGIN_EXPIRES_AT?.trim();
  const frontendExpiration = environment.NEXT_PUBLIC_TEMP_PRODUCTION_STAFF_LOGIN_EXPIRES_AT?.trim();
  if (!backendExpiration || backendExpiration !== frontendExpiration) return null;

  const expiresAtMs = expirationTimestamp(backendExpiration);
  if (
    !Number.isFinite(expiresAtMs)
    || expiresAtMs <= nowMs
    || expiresAtMs - nowMs > MAX_TEMPORARY_STAFF_LOGIN_WINDOW_MS
  ) {
    return null;
  }
  return expiresAtMs;
}

export function isTemporaryProductionStaffIdentity(email: string, role: string) {
  return email.trim().toLowerCase() === TEMPORARY_PRODUCTION_STAFF_EMAIL && role === "STAFF";
}
