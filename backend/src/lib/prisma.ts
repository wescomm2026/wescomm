import { PrismaClient } from "@prisma/client";
import { env } from "../config/env.js";
import { buildRuntimeDatabaseUrl } from "../utils/database-url.js";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: {
      db: {
        // Runtime traffic must use DATABASE_URL (Supavisor transaction mode).
        // DIRECT_URL is reserved for Prisma migrations, dumps, and restores.
        url: buildRuntimeDatabaseUrl(env.DATABASE_URL, env.VERCEL === "1")
      }
    },
    log: env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"]
  });

if (env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
