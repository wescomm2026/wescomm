import type { NextFunction, Request, Response } from "express";

type TimingEntry = { name: string; durationMs: number };

function safeMetricName(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40) || "phase";
}

export function recordRequestTiming(response: Response, name: string, durationMs: number) {
  const timings = (response.locals.timings ?? []) as TimingEntry[];
  timings.push({ name: safeMetricName(name), durationMs });
  response.locals.timings = timings;
  if (!response.headersSent) {
    response.setHeader(
      "Server-Timing",
      timings.map((timing) => `${timing.name};dur=${timing.durationMs.toFixed(1)}`).join(", ")
    );
  }
}

export async function measureRequestPhase<T>(response: Response, name: string, operation: () => Promise<T>) {
  const startedAt = performance.now();
  try {
    return await operation();
  } finally {
    recordRequestTiming(response, name, performance.now() - startedAt);
  }
}

export function requestTimingMiddleware(request: Request, response: Response, next: NextFunction) {
  const startedAt = performance.now();
  response.once("finish", () => {
    const durationMs = performance.now() - startedAt;
    const requestId = String(response.locals.requestId ?? response.getHeader("X-Request-Id") ?? "-");
    const route = String(request.originalUrl ?? request.url).split("?")[0];
    const timings = ((response.locals.timings ?? []) as TimingEntry[]).reduce<Record<string, number>>(
      (result, timing) => {
        result[timing.name] = Math.round(timing.durationMs * 10) / 10;
        return result;
      },
      {}
    );
    const entry = {
      event: durationMs >= 1_000 ? "slow_http_request" : "http_request",
      requestId,
      method: request.method,
      route,
      status: response.statusCode,
      durationMs: Math.round(durationMs * 10) / 10,
      timings
    };
    const serialized = JSON.stringify(entry);
    if (durationMs >= 1_000) console.warn(serialized);
    else console.info(serialized);
  });
  next();
}
