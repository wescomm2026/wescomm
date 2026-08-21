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

type RealtimeEventRecord = Awaited<ReturnType<typeof listRealtimeEvents>>[number];
type RealtimeSubscription = {
  userId: string;
  role: AppRole;
  ready: boolean;
  lastDeliveredId: bigint;
  pending: RealtimeEventRecord[];
  onEvents: (events: RealtimeEventRecord[]) => void;
};

const BROKER_BATCH_SIZE = 100;
const BROKER_POLL_INTERVAL_MS = 750;
const subscriptions = new Map<symbol, RealtimeSubscription>();
let brokerCursor: bigint | null = null;
let brokerTimer: ReturnType<typeof setTimeout> | null = null;
let brokerStartPromise: Promise<void> | null = null;

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

async function getLatestGlobalRealtimeEventId() {
  const latest = await prisma.realtimeEvent.findFirst({
    where: { expiresAt: { gt: new Date() } },
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

function scheduleBrokerPoll(delayMs = BROKER_POLL_INTERVAL_MS) {
  if (!subscriptions.size || brokerTimer) return;
  brokerTimer = setTimeout(() => {
    brokerTimer = null;
    void pollBroker();
  }, delayMs);
  brokerTimer.unref?.();
}

async function pollBroker() {
  if (!subscriptions.size || brokerCursor === null) return;
  try {
    const events = await prisma.realtimeEvent.findMany({
      where: {
        id: { gt: brokerCursor },
        expiresAt: { gt: new Date() }
      },
      orderBy: { id: "asc" },
      take: BROKER_BATCH_SIZE,
      select: {
        id: true,
        topic: true,
        entityId: true,
        payload: true,
        createdAt: true,
        audienceUserId: true,
        audienceRole: true
      }
    });

    for (const event of events) {
      brokerCursor = event.id;
      for (const subscription of subscriptions.values()) {
        if (
          event.audienceUserId !== subscription.userId
          && event.audienceRole !== subscription.role
        ) continue;
        const publicEvent: RealtimeEventRecord = {
          id: event.id,
          topic: event.topic,
          entityId: event.entityId,
          payload: event.payload,
          createdAt: event.createdAt
        };
        if (!subscription.ready) subscription.pending.push(publicEvent);
        else if (event.id > subscription.lastDeliveredId) {
          subscription.lastDeliveredId = event.id;
          subscription.onEvents([publicEvent]);
        }
      }
    }
    scheduleBrokerPoll(events.length === BROKER_BATCH_SIZE ? 0 : BROKER_POLL_INTERVAL_MS);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown realtime broker error.";
    console.warn(`Realtime broker poll failed: ${message}`);
    scheduleBrokerPoll(2_000);
  }
}

async function ensureBrokerRunning() {
  if (brokerCursor !== null) {
    scheduleBrokerPoll(0);
    return;
  }
  if (!brokerStartPromise) {
    brokerStartPromise = (async () => {
      brokerCursor = await getLatestGlobalRealtimeEventId();
      scheduleBrokerPoll(0);
    })().finally(() => {
      brokerStartPromise = null;
    });
  }
  await brokerStartPromise;
}

export async function subscribeToRealtimeEvents(input: {
  userId: string;
  role: AppRole;
  afterId: bigint;
  onEvents: (events: RealtimeEventRecord[]) => void;
}) {
  const key = Symbol("realtime-subscription");
  const subscription: RealtimeSubscription = {
    userId: input.userId,
    role: input.role,
    ready: false,
    lastDeliveredId: input.afterId,
    pending: [],
    onEvents: input.onEvents
  };
  subscriptions.set(key, subscription);

  try {
    await ensureBrokerRunning();
    const catchupBoundary = brokerCursor ?? input.afterId;
    let catchupCursor = input.afterId;

    while (catchupCursor < catchupBoundary) {
      const events = await listRealtimeEvents({
        userId: input.userId,
        role: input.role,
        afterId: catchupCursor,
        throughId: catchupBoundary,
        limit: BROKER_BATCH_SIZE
      });
      if (!events.length) break;
      input.onEvents(events);
      catchupCursor = events.at(-1)!.id;
      if (events.length < BROKER_BATCH_SIZE) break;
    }

    subscription.lastDeliveredId = catchupBoundary;
    subscription.ready = true;
    const pending = subscription.pending
      .filter((event) => event.id > catchupBoundary)
      .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
    subscription.pending = [];
    if (pending.length) {
      subscription.lastDeliveredId = pending.at(-1)!.id;
      input.onEvents(pending);
    }
  } catch (error) {
    subscriptions.delete(key);
    throw error;
  }

  return () => {
    subscriptions.delete(key);
    if (!subscriptions.size) {
      if (brokerTimer) clearTimeout(brokerTimer);
      brokerTimer = null;
      brokerCursor = null;
    }
  };
}

export async function deleteExpiredRealtimeEvents() {
  const result = await prisma.realtimeEvent.deleteMany({
    where: { expiresAt: { lte: new Date() } }
  });
  return result.count;
}
