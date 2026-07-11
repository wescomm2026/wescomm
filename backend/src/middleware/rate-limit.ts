import type { NextFunction, Request, Response } from "express";

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

type RateLimitOptions = {
  namespace: string;
  windowMs: number;
  max: number;
  key?: (request: Request) => string;
  message?: string;
};

const entries = new Map<string, RateLimitEntry>();
let requestsSinceCleanup = 0;

function requestIp(request: Request) {
  return request.ip || request.socket.remoteAddress || "unknown";
}

function cleanupExpiredEntries(now: number) {
  requestsSinceCleanup += 1;
  if (requestsSinceCleanup < 500) return;

  requestsSinceCleanup = 0;
  entries.forEach((entry, key) => {
    if (entry.resetAt <= now) entries.delete(key);
  });
}

export function userRateLimitKey(request: Request) {
  const authRequest = request as Request & { auth?: { id?: string } };
  return authRequest.auth?.id || requestIp(request);
}

export function ipRateLimitKey(request: Request) {
  return requestIp(request);
}

export function createRateLimiter(options: RateLimitOptions) {
  return (request: Request, response: Response, next: NextFunction) => {
    const now = Date.now();
    cleanupExpiredEntries(now);

    const subject = options.key?.(request) || requestIp(request);
    const key = `${options.namespace}:${subject}`;
    const existing = entries.get(key);
    const entry = !existing || existing.resetAt <= now
      ? { count: 1, resetAt: now + options.windowMs }
      : { count: existing.count + 1, resetAt: existing.resetAt };

    entries.set(key, entry);

    const remaining = Math.max(0, options.max - entry.count);
    response.setHeader("RateLimit-Limit", String(options.max));
    response.setHeader("RateLimit-Remaining", String(remaining));
    response.setHeader("RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > options.max) {
      const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      response.setHeader("Retry-After", String(retryAfter));
      return response.status(429).json({
        error: options.message ?? "Too many requests. Please wait before trying again.",
        retryAfter,
        requestId: String(response.locals.requestId ?? "")
      });
    }

    return next();
  };
}
