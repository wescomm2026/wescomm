const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

export type CookieRequestPolicyInput = {
  method: string;
  hasAuthorizationHeader: boolean;
  hasSessionCookie: boolean;
  origin?: string;
  fetchSite?: string;
};

export function isTrustedCookieRequest(
  input: CookieRequestPolicyInput,
  allowedOrigins: ReadonlySet<string>
) {
  if (safeMethods.has(input.method.toUpperCase())) return true;
  if (input.hasAuthorizationHeader) return true;
  if (!input.hasSessionCookie) return true;

  return Boolean(
    input.origin &&
    allowedOrigins.has(input.origin) &&
    input.fetchSite !== "cross-site"
  );
}
