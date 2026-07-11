import { env } from "../config/env.js";

function vercelOrigin(host: string | undefined) {
  const normalized = host?.trim().toLowerCase();
  if (!normalized || !/^[a-z0-9.-]+\.vercel\.app$/.test(normalized)) return null;
  return `https://${normalized}`;
}

export const allowedFrontendOrigins = new Set([
  ...env.FRONTEND_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean),
  vercelOrigin(process.env.VERCEL_URL),
  vercelOrigin(process.env.VERCEL_PROJECT_PRODUCTION_URL)
].filter((origin): origin is string => Boolean(origin)));
