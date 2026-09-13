import { Prisma, type AppRole } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

export const REALTIME_TOPICS = {
  reservations: "reservations",
  receipts: "receipts",
  notifications: "notifications",
  conversations: "conversations",
  typing: "typing",
  inventory: "inventory",
  dashboard: "dashboard",
  reports: "reports",
  restrictions: "restrictions",
  users: "users"
} as const;

export type RealtimeTopic = typeof REALTIME_TOPICS[keyof typeof REALTIME_TOPICS];

type RealtimeEventWriter = Pick<Prisma.TransactionClient, "realtimeEvent">;

export type RealtimeEventInput = {
  topic: RealtimeTopic;
  dedupeKey?: string;
  entityId?: string | null;
  payload?: Prisma.InputJsonObject;
  audienceUserIds?: string[];
  audienceRoles?: AppRole[];
  ttlMs?: number;
};

export async function publishRealtimeEvents(
  client: RealtimeEventWriter,
  events: RealtimeEventInput[]
) {
  const rows = events.flatMap((event) => {
    const expiresAt = new Date(Date.now() + Math.max(event.ttlMs ?? 24 * 60 * 60 * 1_000, 5_000));
    const common = {
      topic: event.topic,
      entityId: event.entityId ?? null,
      payload: event.payload ?? {},
      expiresAt
    };
    return [
      ...(event.audienceUserIds ?? []).map((audienceUserId) => ({
        ...common,
        audienceUserId,
        dedupeKey: event.dedupeKey ? `${event.dedupeKey}:user:${audienceUserId}` : null
      })),
      ...(event.audienceRoles ?? []).map((audienceRole) => ({
        ...common,
        audienceRole,
        dedupeKey: event.dedupeKey ? `${event.dedupeKey}:role:${audienceRole}` : null
      }))
    ];
  });

  if (!rows.length) return 0;
  const result = await client.realtimeEvent.createMany({ data: rows, skipDuplicates: true });
  return result.count;
}

export async function publishRealtimeEventsBestEffort(events: RealtimeEventInput[]) {
  try {
    return await publishRealtimeEvents(prisma, events);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown realtime publish error.";
    console.warn(`Unable to publish realtime invalidation: ${message}`);
    return 0;
  }
}

export async function getLatestRealtimeEventId(userId: string, role: AppRole) {
  const latest = await prisma.realtimeEvent.findFirst({
    where: {
      expiresAt: { gt: new Date() },
      OR: [{ audienceUserId: userId }, { audienceRole: role }]
    },
    orderBy: { id: "desc" },
    select: { id: true }
  });
  return latest?.id ?? 0n;
}

export async function listRealtimeEvents(input: {
  userId: string;
  role: AppRole;
  afterId: bigint;
  throughId?: bigint;
  limit?: number;
}) {
  return prisma.realtimeEvent.findMany({
    where: {
      id: { gt: input.afterId },
      ...(input.throughId !== undefined ? { id: { gt: input.afterId, lte: input.throughId } } : {}),
      expiresAt: { gt: new Date() },
      OR: [{ audienceUserId: input.userId }, { audienceRole: input.role }]
    },
    orderBy: { id: "asc" },
    take: Math.min(Math.max(input.limit ?? 50, 1), 100),
    select: {
      id: true,
      topic: true,
      entityId: true,
      payload: true,
      createdAt: true
    }
  });
}

export async function deleteExpiredRealtimeEvents() {
  const result = await prisma.realtimeEvent.deleteMany({
    where: { expiresAt: { lte: new Date() } }
  });
  return result.count;
}
