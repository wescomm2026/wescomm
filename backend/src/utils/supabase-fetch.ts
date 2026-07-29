type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];
const STATUS_AWARE_FALLBACKS = new Set([429, 502, 503, 504, 520, 522, 523, 524]);

function isPostgrestRequest(input: FetchInput) {
  try {
    const value = typeof input === "string" || input instanceof URL
      ? input
      : input.url;
    return new URL(value).pathname.startsWith("/rest/v1/");
  } catch {
    return false;
  }
}

/**
 * PostgREST exposes HTTP status beside `error`, but most service call sites
 * only receive the error object. Preserve the final HTTP status in JSON error
 * bodies so the common mapper can distinguish 429/503/504 from application
 * errors after supabase-js exhausts its safe read retries.
 */
export function createSupabaseFetchWithErrorStatus(
  baseFetch: (input: FetchInput, init?: FetchInit) => Promise<Response> = fetch
) {
  return async (input: FetchInput, init?: FetchInit) => {
    const response = await baseFetch(input, init);
    if (response.ok || !isPostgrestRequest(input)) return response;

    let parsedBody: unknown;
    if (response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
      try {
        parsedBody = await response.clone().json();
      } catch {
        parsedBody = undefined;
      }
    }

    const objectError = parsedBody
      && typeof parsedBody === "object"
      && !Array.isArray(parsedBody)
      ? parsedBody as Record<string, unknown>
      : null;

    if (!objectError && !STATUS_AWARE_FALLBACKS.has(response.status)) {
      return response;
    }

    const errorBody = objectError ?? {
          code: `HTTP_${response.status}`,
          message: response.statusText || "Supabase Data API request failed",
          details: null,
          hint: null
        };

    const headers = new Headers(response.headers);
    headers.delete("content-encoding");
    headers.delete("content-length");
    headers.set("content-type", "application/json");

    return new Response(JSON.stringify({
      ...errorBody,
      httpStatus: response.status
    }), {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  };
}
