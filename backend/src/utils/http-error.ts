export class HttpError extends Error {
  status: number;
  code?: string;
  details?: Record<string, unknown>;

  constructor(status: number, message: string, code?: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static fromSupabase(
    error: {
      code?: unknown;
      httpStatus?: unknown;
      message?: unknown;
      status?: unknown;
      statusCode?: unknown;
    },
    context?: string
  ) {
    const code = typeof error.code === "string" ? error.code : "";
    const statusCandidates = [error.httpStatus, error.status, error.statusCode];
    const statusValue = statusCandidates.find((value) => (
      typeof value === "number"
      || (typeof value === "string" && /^\d{3}$/.test(value))
    ));
    const status = statusValue === undefined ? undefined : Number(statusValue);
    const message = typeof error.message === "string"
      ? error.message
      : "Supabase request failed.";
    const transientCode = (
      /^08/.test(code)
      || /^53/.test(code)
      || ["57P01", "57P02", "57P03", "PGRST000", "PGRST001", "PGRST002", "PGRST003", "PGRSTX00"]
        .includes(code)
    );
    const transientStatus = status !== undefined
      && [502, 503, 504, 520, 522, 523, 524].includes(status);
    const transientMessage = /(AbortError|request was aborted|fetch failed|network request failed|connection (?:was )?(?:closed|terminated|timed out)|database (?:is )?unavailable|service unavailable|bad gateway|gateway timeout|cloudflare|upstream connect)/i
      .test(message);

    if (transientCode || transientStatus || transientMessage) {
      return new HttpError(
        503,
        "The database service is temporarily unavailable. Please try again.",
        "DATABASE_TEMPORARILY_UNAVAILABLE",
        { retryable: true }
      );
    }

    if (status === 429 || /(too many requests|rate limit)/i.test(message)) {
      return new HttpError(
        429,
        "Too many requests. Please wait before trying again.",
        "UPSTREAM_RATE_LIMITED"
      );
    }

    return new HttpError(500, context ? `${context}: ${message}` : message);
  }
}
