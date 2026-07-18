export type AuthRuntimeEnvironment = "development" | "test" | "production";

export function normalizeAllowedEmailDomains(value: string) {
  return Array.from(new Set(
    value
      .split(",")
      .map((item) => item.trim().toLowerCase().replace(/^@/, ""))
      .filter(Boolean)
  ));
}

export function validateAllowedEmailDomains(value: string, environment: AuthRuntimeEnvironment) {
  const domains = normalizeAllowedEmailDomains(value);
  if (domains.length === 0) {
    throw new Error("AUTH_ALLOWED_EMAIL_DOMAIN(S) must include at least one approved school email domain.");
  }
  if (environment === "production" && domains.includes("*")) {
    throw new Error("AUTH_ALLOWED_EMAIL_DOMAIN(S) must not use a wildcard in production.");
  }
  return domains;
}

export function isEmailAllowedForDomains(email: string, allowedDomains: readonly string[]) {
  if (allowedDomains.includes("*")) return true;
  const normalizedEmail = email.trim().toLowerCase();
  const separator = normalizedEmail.indexOf("@");
  if (separator <= 0 || separator === normalizedEmail.length - 1) return false;
  if (separator !== normalizedEmail.lastIndexOf("@")) return false;
  return allowedDomains.includes(normalizedEmail.slice(separator + 1));
}
