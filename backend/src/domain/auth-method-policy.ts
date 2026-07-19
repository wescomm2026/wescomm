export type AuthMethodPolicyResult = {
  allowed: boolean;
  methods: string[];
  reason?: "MISSING" | "PASSWORD" | "NOT_ALLOWED" | "MISSING_PRIMARY";
};

const auxiliaryMethods = new Set(["token_refresh"]);

export function normalizeAllowedAuthMethods(value: string) {
  return [...new Set(
    value
      .split(",")
      .map((method) => method.trim().toLowerCase())
      .filter(Boolean)
  )];
}

export function readAuthenticationMethods(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) return [];

  const methods: string[] = [];
  for (const entry of value) {
    const method = typeof entry === "string"
      ? entry
      : typeof entry === "object" && entry !== null && "method" in entry
        ? (entry as { method?: unknown }).method
        : null;
    if (typeof method !== "string" || method.trim() === "") return [];
    methods.push(method.trim().toLowerCase());
  }

  return [...new Set(methods)];
}

export function evaluateAuthenticationMethods(
  amrClaim: unknown,
  allowedMethods: readonly string[]
): AuthMethodPolicyResult {
  const methods = readAuthenticationMethods(amrClaim);
  if (methods.length === 0) return { allowed: false, methods, reason: "MISSING" };
  if (methods.includes("password")) return { allowed: false, methods, reason: "PASSWORD" };

  const allowed = new Set(allowedMethods.map((method) => method.toLowerCase()));
  if (methods.some((method) => !allowed.has(method))) {
    return { allowed: false, methods, reason: "NOT_ALLOWED" };
  }
  if (!methods.some((method) => !auxiliaryMethods.has(method))) {
    return { allowed: false, methods, reason: "MISSING_PRIMARY" };
  }

  return { allowed: true, methods };
}
