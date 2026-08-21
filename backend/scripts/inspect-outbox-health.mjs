import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

dotenv.config({ path: ".env" });

const prisma = new PrismaClient();

try {
  const [health] = await prisma.$queryRaw`
    SELECT
      COUNT(*)::integer AS "totalEvents",
      COUNT(*) FILTER (WHERE "processed_at" IS NOT NULL)::integer AS "processedEvents",
      COUNT(*) FILTER (WHERE "processed_at" IS NULL)::integer AS "pendingEvents",
      COUNT(*) FILTER (
        WHERE "processed_at" IS NULL AND "available_at" <= NOW()
      )::integer AS "dueEvents",
      COUNT(*) FILTER (
        WHERE "processed_at" IS NULL
          AND "locked_at" IS NOT NULL
          AND "locked_at" < NOW() - INTERVAL '5 minutes'
      )::integer AS "staleLocks",
      COUNT(*) FILTER (
        WHERE "processed_at" IS NULL AND "last_error" IS NOT NULL
      )::integer AS "retryingEvents",
      COUNT(*) FILTER (
        WHERE "processed_at" IS NULL AND "created_at" < NOW() - INTERVAL '1 hour'
      )::integer AS "pendingOverOneHour",
      COALESCE(MAX("attempt_count"), 0)::integer AS "maxAttemptCount"
    FROM "outbox_events"
  `;

  const [notificationDuplicates] = await prisma.$queryRaw`
    SELECT COUNT(*)::integer AS "duplicateKeys"
    FROM (
      SELECT "dedupe_key"
      FROM "notifications"
      WHERE "dedupe_key" IS NOT NULL
      GROUP BY "dedupe_key"
      HAVING COUNT(*) > 1
    ) duplicates
  `;

  const [auditDuplicates] = await prisma.$queryRaw`
    SELECT COUNT(*)::integer AS "duplicateKeys"
    FROM (
      SELECT "dedupe_key"
      FROM "audit_logs"
      WHERE "dedupe_key" IS NOT NULL
      GROUP BY "dedupe_key"
      HAVING COUNT(*) > 1
    ) duplicates
  `;

  console.log(JSON.stringify({
    ...health,
    duplicateNotificationKeys: notificationDuplicates.duplicateKeys,
    duplicateAuditKeys: auditDuplicates.duplicateKeys
  }));
} finally {
  await prisma.$disconnect();
}
