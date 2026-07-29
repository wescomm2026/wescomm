import { Router } from "express";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../utils/async-handler.js";
import {
  DATABASE_RETRY_AFTER_SECONDS,
  isTransientPrismaConnectionError,
  withTransientPrismaReadRetry
} from "../utils/prisma-retry.js";

export const healthRoutes = Router();

healthRoutes.get("/", (_request, response) => {
  response.json({ status: "ok", service: "wescomm-backend" });
});

healthRoutes.get(
  "/ready",
  asyncHandler(async (_request, response) => {
    const encryptionReady = Boolean(env.DATA_ENCRYPTION_KEYS);

    try {
      const rows = await withTransientPrismaReadRetry(
        () => prisma.$queryRaw<Array<{ auth_sessions: string | null }>>`
          select to_regclass('public.auth_sessions')::text as auth_sessions
        `,
        { maxAttempts: 2 }
      );
      const sessionsReady = rows[0]?.auth_sessions === "auth_sessions";
      const ready = sessionsReady && encryptionReady;

      return response.status(ready ? 200 : 503).json({
        status: ready ? "ready" : "setup-required",
        checks: {
          database: true,
          secureSessions: sessionsReady,
          fieldEncryption: encryptionReady
        }
      });
    } catch (error) {
      if (!isTransientPrismaConnectionError(error)) {
        console.error("Database readiness probe failed:", error);
      }

      response.setHeader("Retry-After", String(DATABASE_RETRY_AFTER_SECONDS));
      return response.status(503).json({
        status: "unavailable",
        checks: {
          database: false,
          secureSessions: false,
          fieldEncryption: encryptionReady
        }
      });
    }
  })
);
