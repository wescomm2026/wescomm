function normalizedHttpUrl(value, label) {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${label} must use HTTP or HTTPS.`);
  }
  return url.toString().replace(/\/$/, "");
}

function sameOriginApiPath(value) {
  const path = value?.trim() || "/api/backend";
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error("NEXT_PUBLIC_API_URL must be an absolute HTTP(S) URL or a same-origin path.");
  }
  return path.replace(/\/$/, "");
}

/**
 * Resolves a URL that a Server Component can use for backend authentication.
 * Local two-server development uses BACKEND_API_URL. Vercel Services uses the
 * current deployment origin plus the project-level /api -> backend rewrite.
 */
export function resolveServerApiBaseUrl(environment = process.env) {
  const directBackendUrl = environment.BACKEND_API_URL?.trim();
  if (directBackendUrl) return normalizedHttpUrl(directBackendUrl, "BACKEND_API_URL");

  const publicApiUrl = environment.NEXT_PUBLIC_API_URL?.trim();
  if (publicApiUrl && /^https?:\/\//i.test(publicApiUrl)) {
    return normalizedHttpUrl(publicApiUrl, "NEXT_PUBLIC_API_URL");
  }

  const apiPath = sameOriginApiPath(publicApiUrl);
  const vercelHost = environment.VERCEL_URL?.trim();
  if (vercelHost) {
    return normalizedHttpUrl(new URL(apiPath, `https://${vercelHost}`).toString(), "VERCEL_URL");
  }

  const frontendOrigin = environment.FRONTEND_ORIGIN?.trim();
  if (frontendOrigin) {
    return normalizedHttpUrl(new URL(apiPath, normalizedHttpUrl(frontendOrigin, "FRONTEND_ORIGIN")).toString(), "FRONTEND_ORIGIN");
  }

  return "http://localhost:4000/api";
}
