import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const backendBaseUrl = (process.env.BACKEND_API_URL ?? "http://localhost:4000/api").replace(/\/$/, "");
const forwardedRequestHeaders = [
  "authorization",
  "content-type",
  "cookie",
  "idempotency-key",
  "origin",
  "sec-fetch-site",
  "user-agent",
  "x-request-id"
];
const forwardedResponseHeaders = [
  "cache-control",
  "content-type",
  "pragma",
  "ratelimit-limit",
  "ratelimit-remaining",
  "ratelimit-reset",
  "retry-after",
  "set-cookie",
  "x-request-id"
];

function requestHostOrigin(request: NextRequest) {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host");
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProtocol || request.nextUrl.protocol.replace(":", "");

  try {
    return host ? new URL(`${protocol}://${host}`).origin : request.nextUrl.origin;
  } catch {
    return request.nextUrl.origin;
  }
}

async function proxy(request: NextRequest, context: { params: { path: string[] } }) {
  const isMutation = !["GET", "HEAD", "OPTIONS"].includes(request.method);
  const browserOrigin = request.headers.get("origin");
  const hostOrigin = requestHostOrigin(request);
  const fetchSite = request.headers.get("sec-fetch-site");
  const acceptedOrigins = new Set([request.nextUrl.origin, hostOrigin]);
  const hasAuthorizationHeader = Boolean(request.headers.get("authorization")?.trim());
  const hasSessionCookie =
    request.cookies.has("wescomm_session") || request.cookies.has("__Host-wescomm_session");
  const needsCookieOriginProof = isMutation && hasSessionCookie && !hasAuthorizationHeader;
  const hasTrustedOrigin = Boolean(browserOrigin && acceptedOrigins.has(browserOrigin));

  if (
    isMutation &&
    (
      (browserOrigin && (fetchSite === "cross-site" || !hasTrustedOrigin)) ||
      (needsCookieOriginProof && !hasTrustedOrigin)
    )
  ) {
    return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 6 * 1024 * 1024) {
    return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
  }

  const target = new URL(`${backendBaseUrl}/${context.params.path.map(encodeURIComponent).join("/")}`);
  request.nextUrl.searchParams.forEach((value, key) => target.searchParams.append(key, value));

  const headers = new Headers();
  forwardedRequestHeaders.forEach((name) => {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  });

  let backendResponse: Response;
  try {
    backendResponse = await fetch(target, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer(),
      cache: "no-store",
      redirect: "manual"
    });
  } catch {
    return NextResponse.json(
      { error: "WESCOMM services are temporarily unavailable." },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }

  const responseHeaders = new Headers();
  forwardedResponseHeaders.forEach((name) => {
    const value = backendResponse.headers.get(name);
    if (value) responseHeaders.set(name, value);
  });

  const responseHasNoBody = request.method === "HEAD" || [204, 205, 304].includes(backendResponse.status);
  return new NextResponse(responseHasNoBody ? null : backendResponse.body, {
    status: backendResponse.status,
    headers: responseHeaders
  });
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
