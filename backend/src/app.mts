import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { env } from "./config/env.js";
import { requireTrustedCookieOrigin } from "./middleware/csrf.js";
import { apiRoutes } from "./routes/index.js";
import { paymongoWebhookHandler } from "./routes/paymongo-webhook.routes.js";
import { allowedFrontendOrigins } from "./utils/allowed-origins.js";
import { HttpError } from "./utils/http-error.js";
import {
  DATABASE_RETRY_AFTER_SECONDS,
  isTransientPrismaConnectionError
} from "./utils/prisma-retry.js";

export const app = express();

morgan.token("safe-url", (request) => String((request as express.Request).originalUrl ?? request.url).split("?")[0]);
morgan.token("request-id", (_request, response) => String(response.getHeader("X-Request-Id") ?? "-"));

app.disable("x-powered-by");
if (env.TRUST_PROXY_HOPS > 0) app.set("trust proxy", env.TRUST_PROXY_HOPS);

app.use((_request, response, next) => {
  const requestId = randomUUID();
  response.locals.requestId = requestId;
  response.setHeader("X-Request-Id", requestId);
  next();
});

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedFrontendOrigins.has(origin)) return callback(null, true);
    return callback(new HttpError(403, "Origin is not allowed."));
  },
  credentials: true,
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Authorization", "Content-Type", "Idempotency-Key", "X-Request-Id"],
  exposedHeaders: ["X-Request-Id", "RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset", "Retry-After"],
  maxAge: 600
}));
app.use(morgan(
  env.NODE_ENV === "production"
    ? ":date[iso] :method :safe-url :status :response-time ms request=:request-id"
    : ":method :safe-url :status :response-time ms"
));

// PayMongo signs the exact bytes sent. This route must remain before every
// JSON parser and before cookie-origin/CSRF middleware.
app.post(
  "/api/webhooks/paymongo",
  express.raw({ type: "application/json", limit: "256kb" }),
  paymongoWebhookHandler
);

app.use(express.json({ limit: "6mb" }));
app.use(requireTrustedCookieOrigin);

app.use("/api", (_request, response, next) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Pragma", "no-cache");
  next();
}, apiRoutes);

app.use((_request, _response, next) => {
  next(new HttpError(404, "Route not found."));
});

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  const requestId = String(response.locals.requestId ?? "");

  if (error instanceof SyntaxError && "body" in error) {
    return response.status(400).json({ error: "Request body contains invalid JSON.", requestId });
  }

  if (typeof error === "object" && error && "type" in error && error.type === "entity.too.large") {
    return response.status(413).json({ error: "Request body is too large.", requestId });
  }

  if (error instanceof HttpError) {
    if (error.status >= 500) console.error(`[${requestId}]`, error);
    const temporarilyUnavailable = (
      error.status === 503
      && error.details?.retryable === true
    );
    if (temporarilyUnavailable) {
      response.setHeader("Retry-After", String(DATABASE_RETRY_AFTER_SECONDS));
    }
    const message = temporarilyUnavailable
      ? "The service is temporarily unavailable. Please try again."
      : error.status >= 500 && env.NODE_ENV === "production"
        ? "Internal server error."
        : error.message;
    return response.status(error.status).json({
      error: message,
      code: error.code,
      details: error.details,
      requestId
    });
  }

  if (isTransientPrismaConnectionError(error)) {
    console.error(`[${requestId}] transient database failure`, error);
    response.setHeader("Retry-After", String(DATABASE_RETRY_AFTER_SECONDS));
    return response.status(503).json({
      error: "The service is temporarily unavailable. Please try again.",
      code: "DATABASE_TEMPORARILY_UNAVAILABLE",
      details: { retryable: true },
      requestId
    });
  }

  if (error instanceof ZodError) {
    return response.status(400).json({
      error: "Invalid request data.",
      details: error.flatten(),
      requestId
    });
  }

  console.error(`[${requestId}]`, error);
  return response.status(500).json({ error: "Internal server error.", requestId });
});

// Keep this entrypoint as .mts so Vercel's Express runtime preserves ESM
// semantics after moving the service entry to the function bundle root.
export default app;
