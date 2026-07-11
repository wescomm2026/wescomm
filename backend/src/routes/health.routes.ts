import { Router } from "express";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../utils/async-handler.js";

export const healthRoutes = Router();

healthRoutes.get("/", (_request, response) => {
  response.json({ status: "ok", service: "wescomm-backend" });
});

healthRoutes.get(
  "/ready",
  asyncHandler(async (_request, response) => {
    const rows = await prisma.$queryRaw<Array<{ auth_sessions: string | null }>>`
      select to_regclass('public.auth_sessions')::text as auth_sessions
    `;
    const sessionsReady = rows[0]?.auth_sessions === "auth_sessions";
    const encryptionReady = Boolean(env.DATA_ENCRYPTION_KEYS);
    const ready = sessionsReady && encryptionReady;

    response.status(ready ? 200 : 503).json({
      status: ready ? "ready" : "setup-required",
      checks: {
        database: true,
        secureSessions: sessionsReady,
        fieldEncryption: encryptionReady
      }
    });
  })
);
