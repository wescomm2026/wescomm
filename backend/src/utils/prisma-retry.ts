const TRANSIENT_PRISMA_CONNECTION_CODES = new Set(["P1001", "P2024"]);

export function isTransientPrismaConnectionError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; errorCode?: unknown; message?: unknown; name?: unknown };
  const hasTransientCode = [candidate.code, candidate.errorCode]
    .filter((value): value is string => typeof value === "string")
    .some((code) => TRANSIENT_PRISMA_CONNECTION_CODES.has(code));
  if (hasTransientCode) return true;

  // Prisma 5 can omit errorCode on a P1001 initialization failure. Keep the
  // fallback narrow so invalid credentials/schema/configuration are not retried.
  return candidate.name === "PrismaClientInitializationError"
    && typeof candidate.message === "string"
    && /can't reach database server/i.test(candidate.message);
}

export async function withTransientPrismaReadRetry<T>(
  operation: () => Promise<T>,
  options: { maxAttempts?: number; delayMs?: number } = {}
) {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 2);
  const delayMs = Math.max(0, options.delayMs ?? 150);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= maxAttempts || !isTransientPrismaConnectionError(error)) throw error;
      if (delayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw new Error("Prisma read retry exhausted unexpectedly.");
}
