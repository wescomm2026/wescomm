import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { env } from "./config/env.js";
import { requireTrustedCookieOrigin } from "./middleware/csrf.js";
import { apiRoutes } from "./routes/index.js";
import { allowedFrontendOrigins } from "./utils/allowed-origins.js";
import { HttpError } from "./utils/http-error.js";

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
  allowedHeaders: ["Authorization", "Content-Type", "X-Request-Id"],
  exposedHeaders: ["X-Request-Id", "RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset", "Retry-After"],
  maxAge: 600
}));
app.use(express.json({ limit: "6mb" }));
app.use(morgan(
  env.NODE_ENV === "production"
    ? ":date[iso] :method :safe-url :status :response-time ms request=:request-id"
    : ":method :safe-url :status :response-time ms"
));
app.use(requireTrustedCookieOrigin);

app.use("/api", apiRoutes);

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
    const message = error.status >= 500 && env.NODE_ENV === "production"
      ? "Internal server error."
      : error.message;
    return response.status(error.status).json({
      error: message,
      code: error.code,
      details: error.details,
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

export default app;
