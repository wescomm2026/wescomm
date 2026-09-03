import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../utils/http-error.js";

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

export type RateLimitStore = {
  increment(key: string, windowMs: number, now: number): Promise<RateLimitEntry>;
};

type RateLimitOptions = {
  namespace: string;
  windowMs: number;
  max: number;
  key?: (request: Request) => string;
  message?: string;
  store?: RateLimitStore;
};

function requestIp(request: Request) {
  return request.ip || request.socket.remoteAddress || "unknown";
}

export function createMemoryRateLimitStore(): RateLimitStore {
  const entries = new Map<string, RateLimitEntry>();
  let requestsSinceCleanup = 0;

  return {
    async increment(key, windowMs, now) {
      requestsSinceCleanup += 1;
      if (requestsSinceCleanup >= 500) {
        requestsSinceCleanup = 0;
        entries.forEach((entry, entryKey) => {
          if (entry.resetAt <= now) entries.delete(entryKey);
        });
      }

      const existing = entries.get(key);
      const entry = !existing || existing.resetAt <= now
        ? { count: 1, resetAt: now + windowMs }
        : { count: existing.count + 1, resetAt: existing.resetAt };
      entries.set(key, entry);
      return entry;
    }
  };
}

export function createPostgresRateLimitStore(): RateLimitStore {
  return {
    async increment(key, windowMs, now) {
      const keyHash = createHash("sha256").update(key).digest("hex");
      const observedAt = new Date(now);
      const nextResetAt = new Date(now + windowMs);
      const rows = await prisma.$queryRaw<Array<{ count: number; resetAt: Date }>>(Prisma.sql`
        INSERT INTO "rate_limit_counters" AS counter (
          "key_hash",
          "count",
          "reset_at",
          "updated_at"
        ) VALUES (
          ${keyHash},
          1,
          ${nextResetAt},
          ${observedAt}
        )
        ON CONFLICT ("key_hash") DO UPDATE
        SET
          "count" = CASE
            WHEN counter."reset_at" <= ${observedAt} THEN 1
            ELSE counter."count" + 1
          END,
          "reset_at" = CASE
            WHEN counter."reset_at" <= ${observedAt} THEN ${nextResetAt}
            ELSE counter."reset_at"
          END,
          "updated_at" = ${observedAt}
        RETURNING
          "count",
          "reset_at" AS "resetAt"
      `);
      const entry = rows[0];
      if (!entry) throw new Error("Distributed rate-limit counter did not return a result.");
      return { count: entry.count, resetAt: entry.resetAt.getTime() };
    }
  };
}

const memoryStore = createMemoryRateLimitStore();
const postgresStore = createPostgresRateLimitStore();

function defaultRateLimitStore() {
  return process.env.NODE_ENV === "production" || process.env.VERCEL === "1"
    ? postgresStore
    : memoryStore;
}

export function userRateLimitKey(request: Request) {
  const authRequest = request as Request & { auth?: { id?: string } };
  return authRequest.auth?.id || requestIp(request);
}

export function ipRateLimitKey(request: Request) {
  return requestIp(request);
}

export function createRateLimiter(options: RateLimitOptions) {
  const store = options.store ?? defaultRateLimitStore();

  return async (request: Request, response: Response, next: NextFunction) => {
    const now = Date.now();
    const subject = options.key?.(request) || requestIp(request);
    const key = `${options.namespace}:${subject}`;

    let entry: RateLimitEntry;
    try {
      entry = await store.increment(key, options.windowMs, now);
    } catch {
      return next(new HttpError(
        503,
        "Request throttling is temporarily unavailable.",
        "RATE_LIMIT_STORE_UNAVAILABLE",
        { retryable: true }
      ));
    }

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

export function deleteExpiredRateLimitCounters() {
  return prisma.rateLimitCounter.deleteMany({ where: { resetAt: { lte: new Date() } } });
}
