export const DATABASE_RETRY_AFTER_SECONDS = 2;

const TRANSIENT_PRISMA_CONNECTION_CODES = new Set([
  "P1001", // database host cannot be reached
  "P1002", // database connection timed out
  "P1008", // operation timed out
  "P1017", // server closed the connection
  "P2024" // Prisma pool acquisition timed out
]);
const TRANSIENT_NETWORK_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT"
]);

export function isTransientPrismaConnectionError(error: unknown) {
  let candidate: unknown = error;

  // Prisma and Node may put the transport error on `cause`. Limit traversal so
  // a malformed/cyclic error object cannot trap request handling.
  for (let depth = 0; depth < 3; depth += 1) {
    if (!candidate || typeof candidate !== "object") return false;
    const details = candidate as {
      cause?: unknown;
      code?: unknown;
      errorCode?: unknown;
      message?: unknown;
      name?: unknown;
    };
    const codes = [details.code, details.errorCode]
      .filter((value): value is string => typeof value === "string");

    if (codes.some((code) => (
      TRANSIENT_PRISMA_CONNECTION_CODES.has(code)
      || TRANSIENT_NETWORK_CODES.has(code)
    ))) {
      return true;
    }

    // Prisma 5 can omit errorCode on an initialization failure. Keep this
    // fallback narrow so invalid credentials/schema/configuration are not
    // retried.
    if (
      details.name === "PrismaClientInitializationError"
      && typeof details.message === "string"
      && /(can't reach database server|connection timed out|server has closed the connection)/i.test(details.message)
    ) {
      return true;
    }

    if (!details.cause || details.cause === candidate) return false;
    candidate = details.cause;
  }

  return false;
}

export async function withTransientPrismaReadRetry<T>(
  operation: () => Promise<T>,
  options: {
    maxAttempts?: number;
    delayMs?: number;
    maxDelayMs?: number;
    jitterRatio?: number;
    random?: () => number;
    sleep?: (delayMs: number) => Promise<void>;
  } = {}
) {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const baseDelayMs = Math.max(0, options.delayMs ?? 150);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? 1_000);
  const jitterRatio = Math.min(1, Math.max(0, options.jitterRatio ?? 0.2));
  const random = options.random ?? Math.random;
  const sleep = options.sleep ?? (
    (delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs))
  );

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= maxAttempts || !isTransientPrismaConnectionError(error)) throw error;
      const exponentialDelay = Math.min(maxDelayMs, baseDelayMs * (2 ** (attempt - 1)));
      const jitterMultiplier = 1 + ((random() * 2 - 1) * jitterRatio);
      const nextDelayMs = Math.max(0, Math.round(exponentialDelay * jitterMultiplier));
      if (nextDelayMs > 0) {
        await sleep(nextDelayMs);
      }
    }
  }

  throw new Error("Prisma read retry exhausted unexpectedly.");
}
