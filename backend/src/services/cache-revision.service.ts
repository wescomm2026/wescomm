import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma.js";

export type OperationalCacheScope = "products" | "dashboard" | "reports";

const keyForScope = (scope: OperationalCacheScope) => `system.cache-revision.${scope}`;

function revisionFromValue(value: unknown) {
  if (!value || typeof value !== "object" || !("revision" in value)) return "0";
  const revision = (value as { revision?: unknown }).revision;
  return typeof revision === "string" && revision ? revision : "0";
}

export async function readCacheRevision(scope: OperationalCacheScope) {
  const setting = await prisma.appSetting.findUnique({
    where: { key: keyForScope(scope) },
    select: { value: true }
  });
  return revisionFromValue(setting?.value);
}

export async function bumpCacheRevision(scope: OperationalCacheScope) {
  const revision = `${Date.now()}-${randomUUID()}`;
  await prisma.appSetting.upsert({
    where: { key: keyForScope(scope) },
    create: { key: keyForScope(scope), value: { revision } },
    update: { value: { revision }, updatedAt: new Date() }
  });
  return revision;
}
