import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import {
  addCalendarDays,
  manilaDateKey,
  pickupDateColumnKey,
  pickupInstant,
  pickupWeekday,
  resolvePickupBookingWindow,
  scheduleReviewReason,
  validatePickupSelection,
  type PickupBookingWindow,
  type PickupPolicySnapshot
} from "../domain/pickup-schedule.js";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../utils/http-error.js";
import { OUTBOX_EVENT_TYPES } from "./outbox.service.js";
import {
  ACTIVE_PICKUP_CAPACITY_STATUSES,
  assertPickupWindowCapacity,
  pickupCapacitySnapshot,
  pickupWindowKey
} from "./pickup-capacity.service.js";
import { publishRealtimeEvents, REALTIME_TOPICS, wakeRealtimeBroker } from "./realtime-event.service.js";

const pickupPolicySelect = Prisma.validator<Prisma.PickupPolicyVersionSelect>()({
  id: true,
  version: true,
  timezone: true,
  minAdvanceDays: true,
  maxAdvanceDays: true,
  effectiveAt: true,
  isActive: true,
  reason: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { id: true, fullName: true, email: true } },
  days: { orderBy: { weekday: "asc" }, select: { weekday: true, enabled: true } },
  timeSlots: {
    orderBy: [{ sortOrder: "asc" }, { startMinute: "asc" }],
    select: {
      id: true,
      label: true,
      startMinute: true,
      endMinute: true,
      isActive: true,
      sortOrder: true,
      capacity: true
    }
  },
  closures: { orderBy: { date: "asc" }, select: { id: true, date: true, reason: true } }
});

type PickupPolicyRecord = Prisma.PickupPolicyVersionGetPayload<{ select: typeof pickupPolicySelect }>;

export type PickupPolicyInput = {
  minAdvanceDays: number;
  maxAdvanceDays: number;
  reason: string;
  days: Array<{ weekday: number; enabled: boolean }>;
  timeSlots: Array<{
    label: string;
    startMinute: number;
    endMinute: number;
    isActive: boolean;
    capacity: number | null;
  }>;
  closures: Array<{ date: string; reason: string }>;
};

export type PickupPolicyActivationInput = PickupPolicyInput & {
  expectedCurrentPolicyVersion: number;
  previewFingerprint: string;
  idempotencyKey: string;
};

const ACTIVE_RESERVATION_STATUSES = ACTIVE_PICKUP_CAPACITY_STATUSES;

function asSnapshot(policy: PickupPolicyRecord): PickupPolicySnapshot {
  return {
    version: policy.version,
    minAdvanceDays: policy.minAdvanceDays,
    maxAdvanceDays: policy.maxAdvanceDays,
    days: policy.days,
    timeSlots: policy.timeSlots,
    closures: policy.closures
  };
}

function serializePolicy(policy: PickupPolicyRecord, now = new Date()) {
  const window = resolvePickupBookingWindow(asSnapshot(policy), now);
  return {
    id: policy.id,
    version: policy.version,
    timezone: policy.timezone,
    minAdvanceDays: policy.minAdvanceDays,
    maxAdvanceDays: policy.maxAdvanceDays,
    minDate: window.minDate,
    maxDate: window.maxDate,
    serverDate: window.serverDate,
    effectiveAt: policy.effectiveAt.toISOString(),
    isActive: policy.isActive,
    reason: policy.reason,
    createdById: policy.createdById,
    createdBy: policy.createdBy,
    createdAt: policy.createdAt.toISOString(),
    updatedAt: policy.updatedAt.toISOString(),
    days: policy.days,
    timeSlots: policy.timeSlots,
    closures: policy.closures.map((closure) => ({
      id: closure.id,
      date: pickupDateColumnKey(closure.date),
      reason: closure.reason
    }))
  };
}

export function serializePublicPolicy(policy: PickupPolicyRecord, now = new Date()) {
  const window = resolvePickupBookingWindow(asSnapshot(policy), now);
  return {
    version: policy.version,
    timezone: policy.timezone,
    minAdvanceDays: policy.minAdvanceDays,
    maxAdvanceDays: policy.maxAdvanceDays,
    minDate: window.minDate,
    maxDate: window.maxDate,
    serverDate: window.serverDate,
    isActive: policy.isActive,
    days: policy.days,
    timeSlots: policy.timeSlots
      .filter((slot) => slot.isActive)
      .map((slot) => ({
        id: slot.id,
        label: slot.label,
        startMinute: slot.startMinute,
        endMinute: slot.endMinute,
        isActive: true,
        sortOrder: slot.sortOrder,
        capacity: slot.capacity
      })),
    closures: policy.closures.map((closure) => ({
      date: pickupDateColumnKey(closure.date),
      reason: closure.reason
    }))
  };
}

async function requireCurrentPolicy(client: Prisma.TransactionClient | typeof prisma = prisma) {
  const policy = await client.pickupPolicyVersion.findFirst({
    where: { isActive: true, effectiveAt: { lte: new Date() } },
    orderBy: [{ version: "desc" }],
    select: pickupPolicySelect
  });
  if (!policy) throw new HttpError(503, "Pickup scheduling is temporarily unavailable.", "PICKUP_POLICY_UNAVAILABLE");
  return policy;
}

export async function getPickupAvailability() {
  return serializePublicPolicy(await requireCurrentPolicy());
}

export async function getPickupSlotAvailability(input: {
  pickupDate: string;
  pickupPolicyVersion: number;
}) {
  const policy = await requireCurrentPolicy();
  const activeSlots = policy.timeSlots.filter((slot) => slot.isActive);
  if (!activeSlots.length) {
    throw new HttpError(503, "Pickup scheduling is temporarily unavailable.", "PICKUP_POLICY_UNAVAILABLE");
  }

  validatePickupSelection({
    policy: asSnapshot(policy),
    policyVersion: input.pickupPolicyVersion,
    pickupDate: input.pickupDate,
    slotId: activeSlots[0].id
  });

  const windows = activeSlots.map((slot) => ({
    slot,
    pickupStart: pickupInstant(input.pickupDate, slot.startMinute),
    pickupEnd: pickupInstant(input.pickupDate, slot.endMinute)
  }));
  const reservations = await prisma.reservation.findMany({
    where: {
      status: { in: [...ACTIVE_RESERVATION_STATUSES] },
      pickupStart: { in: windows.map((window) => window.pickupStart) },
      pickupEnd: { in: windows.map((window) => window.pickupEnd) }
    },
    select: { pickupStart: true, pickupEnd: true }
  });
  const bookedByWindow = new Map<string, number>();
  for (const reservation of reservations) {
    if (!reservation.pickupStart || !reservation.pickupEnd) continue;
    const key = pickupWindowKey(reservation.pickupStart, reservation.pickupEnd);
    bookedByWindow.set(key, (bookedByWindow.get(key) ?? 0) + 1);
  }

  return {
    pickupDate: input.pickupDate,
    pickupPolicyVersion: policy.version,
    slots: windows.map(({ slot, pickupStart, pickupEnd }) => ({
      slotId: slot.id,
      ...pickupCapacitySnapshot(slot.capacity, bookedByWindow.get(pickupWindowKey(pickupStart, pickupEnd)) ?? 0)
    }))
  };
}

export async function getCurrentPickupPolicy() {
  return serializePolicy(await requireCurrentPolicy());
}

export async function listPickupPolicyVersions(limit = 20) {
  const policies = await prisma.pickupPolicyVersion.findMany({
    orderBy: { version: "desc" },
    take: Math.min(Math.max(limit, 1), 50),
    select: pickupPolicySelect
  });
  return policies.map((policy) => serializePolicy(policy));
}

export async function validatePickupSelectionInTransaction(
  tx: Prisma.TransactionClient,
  input: { pickupDate: string; pickupSlotId: string; pickupPolicyVersion: number },
  options: { now?: Date; excludeReservationId?: string } = {}
) {
  const policy = await requireCurrentPolicy(tx);
  const validated = validatePickupSelection({
    policy: asSnapshot(policy),
    policyVersion: input.pickupPolicyVersion,
    pickupDate: input.pickupDate,
    slotId: input.pickupSlotId,
    now: options.now
  });
  await assertPickupWindowCapacity({
    tx,
    pickupStart: validated.pickupStart,
    pickupEnd: validated.pickupEnd,
    slot: validated.slot,
    excludeReservationId: options.excludeReservationId
  });
  return { ...validated, policy };
}

function inputSnapshot(input: PickupPolicyInput, version: number): PickupPolicySnapshot {
  return {
    version,
    minAdvanceDays: input.minAdvanceDays,
    maxAdvanceDays: input.maxAdvanceDays,
    days: input.days,
    timeSlots: input.timeSlots.map((slot, index) => ({ id: `preview-${index}`, ...slot })),
    closures: input.closures.map((closure) => ({
      date: new Date(`${closure.date}T00:00:00.000Z`),
      reason: closure.reason
    }))
  };
}

function normalizedPolicyInput(input: PickupPolicyInput) {
  return {
    minAdvanceDays: input.minAdvanceDays,
    maxAdvanceDays: input.maxAdvanceDays,
    reason: input.reason.trim(),
    days: [...input.days].sort((left, right) => left.weekday - right.weekday),
    timeSlots: input.timeSlots.map((slot) => ({ ...slot, capacity: slot.capacity ?? null, label: slot.label.trim() })),
    closures: [...input.closures]
      .map((closure) => ({ ...closure, reason: closure.reason.trim() }))
      .sort((left, right) => left.date.localeCompare(right.date))
  };
}

function stableHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function pickupMinute(value: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(value);
  return Number(parts.find((part) => part.type === "hour")?.value ?? 0) * 60
    + Number(parts.find((part) => part.type === "minute")?.value ?? 0);
}

type AffectedReservation = {
  id: string;
  studentId: string;
  referenceCode: string;
  pickupStart: Date | null;
  pickupEnd: Date | null;
  createdAt: Date;
  scheduleRevision: number;
  pickupPolicyVersion: { version: number } | null;
  pickupTimeSlot: { label: string } | null;
};

type PickupImpact = AffectedReservation & {
  action: "AUTO_RESCHEDULE" | "NEEDS_REVIEW";
  reason: string;
  closureDate: string | null;
  closureReason: string | null;
  proposedPickupStart: Date | null;
  proposedPickupEnd: Date | null;
  proposedSlotId: string | null;
  proposedSlotLabel: string | null;
};

function proposedClosureForReservation(policy: PickupPolicySnapshot, reservation: AffectedReservation) {
  if (!reservation.pickupStart) return null;
  const date = manilaDateKey(reservation.pickupStart);
  const closure = policy.closures.find((entry) => pickupDateColumnKey(entry.date) === date);
  return closure ? { date, reason: closure.reason } : null;
}

export function findAutomaticPickupDestination(
  policy: PickupPolicySnapshot,
  reservation: Pick<AffectedReservation, "pickupStart" | "pickupEnd">,
  now: Date,
  bookedByWindow: ReadonlyMap<string, number> = new Map(),
  bookingWindow?: PickupBookingWindow
) {
  if (!reservation.pickupStart || !reservation.pickupEnd) return null;
  const { minDate, maxDate } = bookingWindow ?? resolvePickupBookingWindow(policy, now);
  let date = addCalendarDays(manilaDateKey(reservation.pickupStart), 1);
  if (date < minDate) date = minDate;

  const startMinute = pickupMinute(reservation.pickupStart);
  const endMinute = pickupMinute(reservation.pickupEnd);
  const activeSlots = policy.timeSlots
    .filter((slot) => slot.isActive)
    .sort((left, right) => left.startMinute - right.startMinute);
  const matchingSlot = activeSlots.find((entry) => entry.startMinute === startMinute && entry.endMinute === endMinute);
  const candidateSlots = matchingSlot ? [matchingSlot] : activeSlots;
  if (!candidateSlots.length) return null;

  while (date <= maxDate) {
    const weekdayEnabled = policy.days.some((day) => day.weekday === pickupWeekday(date) && day.enabled);
    const closed = policy.closures.some((closure) => pickupDateColumnKey(closure.date) === date);
    if (weekdayEnabled && !closed) {
      for (const slot of candidateSlots) {
        const pickupStart = pickupInstant(date, slot.startMinute);
        const pickupEnd = pickupInstant(date, slot.endMinute);
        const booked = bookedByWindow.get(pickupWindowKey(pickupStart, pickupEnd)) ?? 0;
        if (!pickupCapacitySnapshot(slot.capacity, booked).isFull) {
          return { pickupStart, pickupEnd, slot };
        }
      }
    }
    date = addCalendarDays(date, 1);
  }
  return null;
}

async function findAffectedReservations(
  client: Prisma.TransactionClient | typeof prisma,
  policy: PickupPolicySnapshot,
  now = new Date()
) {
  const bookingWindow = resolvePickupBookingWindow(policy, now);
  const rows = await client.reservation.findMany({
    where: {
      status: { in: [...ACTIVE_RESERVATION_STATUSES] },
      OR: [
        { pickupEnd: { gte: now } },
        { pickupStart: null },
        { pickupEnd: null }
      ]
    },
    select: {
      id: true,
      studentId: true,
      referenceCode: true,
      pickupStart: true,
      pickupEnd: true,
      createdAt: true,
      scheduleRevision: true,
      pickupPolicyVersion: { select: { version: true } },
      pickupTimeSlot: { select: { label: true } }
    },
    orderBy: [{ pickupStart: "asc" }, { createdAt: "asc" }, { id: "asc" }]
  });

  const bookedByWindow = new Map<string, number>();
  for (const reservation of rows) {
    if (!reservation.pickupStart || !reservation.pickupEnd) continue;
    const key = pickupWindowKey(reservation.pickupStart, reservation.pickupEnd);
    bookedByWindow.set(key, (bookedByWindow.get(key) ?? 0) + 1);
  }

  const impacts: PickupImpact[] = [];
  const admittedByCurrentWindow = new Map<string, number>();
  for (const reservation of rows) {
    const closure = proposedClosureForReservation(policy, reservation);
    if (closure) {
      if (!reservation.pickupStart || !reservation.pickupEnd) {
        impacts.push({
          ...reservation,
          action: "NEEDS_REVIEW",
          reason: "Reservation has no complete pickup schedule.",
          closureDate: closure.date,
          closureReason: closure.reason,
          proposedPickupStart: null,
          proposedPickupEnd: null,
          proposedSlotId: null,
          proposedSlotLabel: null
        });
        continue;
      }
      if (reservation.pickupStart <= now) {
        impacts.push({
          ...reservation,
          action: "NEEDS_REVIEW",
          reason: `Pickup date is closed, but the pickup window already started: ${closure.reason}`,
          closureDate: closure.date,
          closureReason: closure.reason,
          proposedPickupStart: null,
          proposedPickupEnd: null,
          proposedSlotId: null,
          proposedSlotLabel: null
        });
        continue;
      }
      const destination = findAutomaticPickupDestination(policy, reservation, now, bookedByWindow, bookingWindow);
      if (!destination) {
        impacts.push({
          ...reservation,
          action: "NEEDS_REVIEW",
          reason: `No valid pickup date is available within the current booking window after ${closure.date}.`,
          closureDate: closure.date,
          closureReason: closure.reason,
          proposedPickupStart: null,
          proposedPickupEnd: null,
          proposedSlotId: null,
          proposedSlotLabel: null
        });
        continue;
      }
      const destinationKey = pickupWindowKey(destination.pickupStart, destination.pickupEnd);
      bookedByWindow.set(destinationKey, (bookedByWindow.get(destinationKey) ?? 0) + 1);
      impacts.push({
        ...reservation,
        action: "AUTO_RESCHEDULE",
        reason: `Pickup date is closed: ${closure.reason}`,
        closureDate: closure.date,
        closureReason: closure.reason,
        proposedPickupStart: destination.pickupStart,
        proposedPickupEnd: destination.pickupEnd,
        proposedSlotId: destination.slot.id,
        proposedSlotLabel: destination.slot.label
      });
      continue;
    }

    let reason = scheduleReviewReason({
      policy,
      pickupStart: reservation.pickupStart,
      pickupEnd: reservation.pickupEnd,
      now,
      bookingWindow
    });
    if (!reason && reservation.pickupStart && reservation.pickupEnd) {
      const startMinute = pickupMinute(reservation.pickupStart);
      const endMinute = pickupMinute(reservation.pickupEnd);
      const configuredSlot = policy.timeSlots.find((slot) => (
        slot.isActive && slot.startMinute === startMinute && slot.endMinute === endMinute
      ));
      if (configuredSlot?.capacity != null) {
        const key = pickupWindowKey(reservation.pickupStart, reservation.pickupEnd);
        const admitted = (admittedByCurrentWindow.get(key) ?? 0) + 1;
        admittedByCurrentWindow.set(key, admitted);
        if (admitted > configuredSlot.capacity) {
          reason = `Pickup time exceeds the new limit of ${configuredSlot.capacity} active reservation${configuredSlot.capacity === 1 ? "" : "s"}.`;
        }
      }
    }
    if (reason) {
      impacts.push({
        ...reservation,
        action: "NEEDS_REVIEW",
        reason,
        closureDate: null,
        closureReason: null,
        proposedPickupStart: null,
        proposedPickupEnd: null,
        proposedSlotId: null,
        proposedSlotLabel: null
      });
    }
  }
  return impacts;
}

function pickupImpactFingerprint(currentVersion: number, input: PickupPolicyInput, affected: PickupImpact[]) {
  const normalized = normalizedPolicyInput(input);
  const schedulingInput = {
    minAdvanceDays: normalized.minAdvanceDays,
    maxAdvanceDays: normalized.maxAdvanceDays,
    days: normalized.days,
    timeSlots: normalized.timeSlots,
    closures: normalized.closures
  };
  return stableHash({
    currentVersion,
    input: schedulingInput,
    affected: affected.map((reservation) => ({
      id: reservation.id,
      scheduleRevision: reservation.scheduleRevision,
      action: reservation.action,
      reason: reservation.reason,
      proposedPickupStart: reservation.proposedPickupStart?.toISOString() ?? null,
      proposedPickupEnd: reservation.proposedPickupEnd?.toISOString() ?? null,
      proposedSlotLabel: reservation.proposedSlotLabel
    }))
  });
}

function serializeImpact(reservation: PickupImpact) {
  return {
    id: reservation.id,
    referenceCode: reservation.referenceCode,
    pickupStart: reservation.pickupStart?.toISOString() ?? null,
    pickupEnd: reservation.pickupEnd?.toISOString() ?? null,
    scheduleRevision: reservation.scheduleRevision,
    action: reservation.action,
    reason: reservation.reason,
    proposedPickupStart: reservation.proposedPickupStart?.toISOString() ?? null,
    proposedPickupEnd: reservation.proposedPickupEnd?.toISOString() ?? null,
    proposedSlotLabel: reservation.proposedSlotLabel
  };
}

export async function previewPickupPolicy(input: PickupPolicyInput) {
  const current = await requireCurrentPolicy();
  const now = new Date();
  const proposedPolicy = inputSnapshot(input, current.version + 1);
  const affected = await findAffectedReservations(prisma, proposedPolicy, now);
  const autoRescheduledCount = affected.filter((reservation) => reservation.action === "AUTO_RESCHEDULE").length;
  const needsReviewCount = affected.length - autoRescheduledCount;
  return {
    currentVersion: current.version,
    nextVersion: current.version + 1,
    affectedCount: affected.length,
    autoRescheduledCount,
    needsReviewCount,
    bookingWindow: resolvePickupBookingWindow(proposedPolicy, now),
    previewFingerprint: pickupImpactFingerprint(current.version, input, affected),
    affectedReservations: affected.slice(0, 100).map(serializeImpact),
    truncated: affected.length > 100
  };
}

export async function createPickupPolicyVersion(input: PickupPolicyActivationInput, actorId: string) {
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('wescomm-pickup-policy'))`;
    const replay = await tx.pickupPolicyVersion.findUnique({
      where: { activationKey: input.idempotencyKey },
      select: pickupPolicySelect
    });
    if (replay) {
      const replayAudit = await tx.auditLog.findFirst({
        where: { action: "PICKUP_POLICY_ACTIVATED", entityId: replay.id },
        orderBy: { createdAt: "desc" },
        select: { metadata: true }
      });
      const metadata = replayAudit?.metadata && typeof replayAudit.metadata === "object"
        ? replayAudit.metadata as Record<string, unknown>
        : {};
      if (metadata.inputHash !== stableHash(normalizedPolicyInput(input))) {
        throw new HttpError(409, "This request key was already used for a different pickup schedule.", "IDEMPOTENCY_KEY_REUSED");
      }
      return {
        policy: serializePolicy(replay),
        affectedCount: Number(metadata.affectedReservationCount ?? 0),
        autoRescheduledCount: Number(metadata.autoRescheduledCount ?? 0),
        needsReviewCount: Number(metadata.needsReviewCount ?? 0),
        idempotentReplay: true
      };
    }
    const current = await requireCurrentPolicy(tx);
    if (current.version !== input.expectedCurrentPolicyVersion) {
      throw new HttpError(409, "The pickup schedule changed after your preview. Review the latest schedule before saving.", "PICKUP_POLICY_PREVIEW_STALE", {
        currentPolicyVersion: current.version
      });
    }
    const version = current.version + 1;
    const now = new Date();
    const previewAffected = await findAffectedReservations(tx, inputSnapshot(input, version), now);
    const fingerprint = pickupImpactFingerprint(current.version, input, previewAffected);
    if (fingerprint !== input.previewFingerprint) {
      throw new HttpError(409, "Reservations changed after your preview. Review the updated impact before saving.", "PICKUP_POLICY_PREVIEW_STALE");
    }

    await tx.pickupPolicyVersion.update({
      where: { id: current.id },
      data: { isActive: false, updatedAt: now },
      select: { id: true }
    });
    const policy = await tx.pickupPolicyVersion.create({
      data: {
        version,
        timezone: "Asia/Manila",
        minAdvanceDays: input.minAdvanceDays,
        maxAdvanceDays: input.maxAdvanceDays,
        effectiveAt: now,
        isActive: true,
        reason: input.reason,
        activationKey: input.idempotencyKey,
        createdById: actorId,
        days: { create: input.days },
        timeSlots: {
          create: input.timeSlots.map((slot, index) => ({ ...slot, capacity: slot.capacity ?? null, sortOrder: index }))
        },
        closures: {
          create: input.closures.map((closure) => ({
            date: new Date(`${closure.date}T00:00:00.000Z`),
            reason: closure.reason
          }))
        }
      },
      select: pickupPolicySelect
    });

    const affected = await findAffectedReservations(tx, asSnapshot(policy), now);
    const closureByDate = new Map(policy.closures.map((closure) => [pickupDateColumnKey(closure.date), closure]));
    const slotById = new Map(policy.timeSlots.map((slot) => [slot.id, slot]));
    const realtimeEvents: Parameters<typeof publishRealtimeEvents>[1] = [];
    let autoRescheduledCount = 0;
    let needsReviewCount = 0;

    for (const reservation of affected) {
      if (
        reservation.action === "AUTO_RESCHEDULE"
        && reservation.proposedPickupStart
        && reservation.proposedPickupEnd
        && reservation.proposedSlotId
        && reservation.proposedSlotLabel
        && reservation.closureDate
      ) {
        const proposedSlot = slotById.get(reservation.proposedSlotId);
        if (!proposedSlot) {
          throw new HttpError(409, "The proposed pickup time is no longer available. Review the impact again.", "PICKUP_POLICY_PREVIEW_STALE");
        }
        await assertPickupWindowCapacity({
          tx,
          pickupStart: reservation.proposedPickupStart,
          pickupEnd: reservation.proposedPickupEnd,
          slot: proposedSlot,
          excludeReservationId: reservation.id
        });
        const newRevision = reservation.scheduleRevision + 1;
        const mutation = await tx.reservation.updateMany({
          where: {
            id: reservation.id,
            scheduleRevision: reservation.scheduleRevision,
            status: { in: [...ACTIVE_RESERVATION_STATUSES] }
          },
          data: {
            pickupStart: reservation.proposedPickupStart,
            pickupEnd: reservation.proposedPickupEnd,
            pickupPolicyVersionId: policy.id,
            pickupTimeSlotId: reservation.proposedSlotId,
            pickupReviewStatus: "RESCHEDULED",
            pickupReviewReason: null,
            scheduleRevision: newRevision,
            updatedAt: now
          }
        });
        if (mutation.count !== 1) {
          throw new HttpError(409, "A reservation changed while the pickup schedule was being saved. Review the impact again.", "PICKUP_POLICY_PREVIEW_STALE");
        }
        const triggerKey = `pickup-policy:${policy.id}:reservation:${reservation.id}:revision:${reservation.scheduleRevision}`;
        await tx.reservationScheduleChange.create({
          data: {
            reservationId: reservation.id,
            actorId: null,
            source: "SYSTEM_CLOSURE",
            closureId: closureByDate.get(reservation.closureDate)?.id ?? null,
            triggerKey,
            reason: `Automatically rescheduled because pickup is closed on ${reservation.closureDate}: ${reservation.closureReason ?? "Special closure"}`,
            previousPickupStart: reservation.pickupStart,
            previousPickupEnd: reservation.pickupEnd,
            previousPolicyVersion: reservation.pickupPolicyVersion?.version ?? null,
            previousSlotLabel: reservation.pickupTimeSlot?.label ?? null,
            newPickupStart: reservation.proposedPickupStart,
            newPickupEnd: reservation.proposedPickupEnd,
            newPolicyVersion: policy.version,
            newSlotLabel: reservation.proposedSlotLabel,
            previousScheduleRevision: reservation.scheduleRevision,
            newScheduleRevision: newRevision
          }
        });
        await tx.auditLog.create({
          data: {
            actorId: null,
            action: "RESERVATION_PICKUP_AUTO_RESCHEDULED",
            entityType: "reservation",
            entityId: reservation.id,
            dedupeKey: `${triggerKey}:audit`,
            summary: `Automatically rescheduled pickup for reservation ${reservation.referenceCode}.`,
            metadata: {
              initiatedById: actorId,
              pickupPolicyId: policy.id,
              pickupPolicyVersion: policy.version,
              closureDate: reservation.closureDate,
              closureReason: reservation.closureReason,
              previousPickupStart: reservation.pickupStart?.toISOString() ?? null,
              previousPickupEnd: reservation.pickupEnd?.toISOString() ?? null,
              newPickupStart: reservation.proposedPickupStart.toISOString(),
              newPickupEnd: reservation.proposedPickupEnd.toISOString(),
              previousScheduleRevision: reservation.scheduleRevision,
              newScheduleRevision: newRevision
            }
          }
        });
        await tx.outboxEvent.create({
          data: {
            type: OUTBOX_EVENT_TYPES.reservationRescheduled,
            entityId: reservation.id,
            payload: {
              actorId: null,
              initiatedById: actorId,
              studentId: reservation.studentId,
              referenceCode: reservation.referenceCode,
              pickupStart: reservation.proposedPickupStart.toISOString(),
              pickupEnd: reservation.proposedPickupEnd.toISOString(),
              reason: reservation.reason
            }
          }
        });
        realtimeEvents.push({
          topic: REALTIME_TOPICS.reservations,
          entityId: reservation.id,
          audienceUserIds: [reservation.studentId],
          audienceRoles: ["STAFF", "ADMIN"],
          payload: { action: "pickup-auto-rescheduled", scheduleRevision: newRevision }
        });
        autoRescheduledCount += 1;
        continue;
      }

      const mutation = await tx.reservation.updateMany({
        where: { id: reservation.id, scheduleRevision: reservation.scheduleRevision },
        data: { pickupReviewStatus: "NEEDS_REVIEW", pickupReviewReason: reservation.reason, updatedAt: now }
      });
      if (mutation.count !== 1) {
        throw new HttpError(409, "A reservation changed while the pickup schedule was being saved. Review the impact again.", "PICKUP_POLICY_PREVIEW_STALE");
      }
      needsReviewCount += 1;
    }

    await tx.auditLog.create({
      data: {
        actorId,
        action: "PICKUP_POLICY_ACTIVATED",
        entityType: "pickup_policy",
        entityId: policy.id,
        summary: `Activated pickup policy version ${version}.`,
        metadata: {
          previousVersion: current.version,
          version,
          minAdvanceDays: input.minAdvanceDays,
          maxAdvanceDays: input.maxAdvanceDays,
          enabledWeekdays: input.days.filter((day) => day.enabled).map((day) => day.weekday),
          activeSlotCount: input.timeSlots.filter((slot) => slot.isActive).length,
          capacityLimitedSlotCount: input.timeSlots.filter((slot) => slot.isActive && slot.capacity !== null).length,
          closureCount: input.closures.length,
          affectedReservationCount: affected.length,
          autoRescheduledCount,
          needsReviewCount,
          inputHash: stableHash(normalizedPolicyInput(input)),
          reason: input.reason
        }
      }
    });

    await publishRealtimeEvents(tx, [
      {
        topic: REALTIME_TOPICS.reservations,
        entityId: policy.id,
        audienceRoles: ["STAFF", "ADMIN"],
        payload: { action: "pickup-policy-activated", version, affectedCount: affected.length }
      },
      ...realtimeEvents
    ]);
    return {
      policy: serializePolicy(policy, now),
      affectedCount: affected.length,
      autoRescheduledCount,
      needsReviewCount,
      idempotentReplay: false
    };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 5_000,
    timeout: 15_000
  }).catch((error: unknown) => {
    if (error instanceof HttpError && error.code === "PICKUP_SLOT_FULL") {
      throw new HttpError(
        409,
        "Pickup capacity changed after your preview. Review the updated impact before saving.",
        "PICKUP_POLICY_PREVIEW_STALE"
      );
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      throw new HttpError(
        409,
        "Reservations changed while the pickup schedule was being saved. Review the impact again.",
        "PICKUP_POLICY_PREVIEW_STALE",
        { retryable: true }
      );
    }
    throw error;
  });
  wakeRealtimeBroker();
  return result;
}

export async function rescheduleReservation(input: {
  reservationId: string;
  actorId: string;
  expectedScheduleRevision: number;
  pickupDate: string;
  pickupSlotId: string;
  pickupPolicyVersion: number;
  reason: string;
}) {
  const result = await prisma.$transaction(async (tx) => {
    const current = await tx.reservation.findUnique({
      where: { id: input.reservationId },
      select: {
        id: true,
        studentId: true,
        referenceCode: true,
        status: true,
        pickupStart: true,
        pickupEnd: true,
        scheduleRevision: true,
        pickupPolicyVersion: { select: { version: true } },
        pickupTimeSlot: { select: { label: true } }
      }
    });
    if (!current) throw new HttpError(404, "Reservation not found.");
    if (["COMPLETED", "CANCELLED", "NO_SHOW"].includes(current.status)) {
      throw new HttpError(409, "Historical reservations cannot be rescheduled.", "RESERVATION_NOT_RESCHEDULABLE");
    }
    if (current.scheduleRevision !== input.expectedScheduleRevision) {
      throw new HttpError(
        409,
        "The pickup schedule changed while you were reviewing it. Refresh and try again.",
        "RESERVATION_SCHEDULE_CONFLICT",
        { currentScheduleRevision: current.scheduleRevision }
      );
    }

    const selected = await validatePickupSelectionInTransaction(tx, input, { excludeReservationId: current.id });
    const newRevision = current.scheduleRevision + 1;
    await tx.reservation.update({
      where: { id: current.id },
      data: {
        pickupStart: selected.pickupStart,
        pickupEnd: selected.pickupEnd,
        pickupPolicyVersionId: selected.policy.id,
        pickupTimeSlotId: selected.slot.id,
        pickupReviewStatus: "RESCHEDULED",
        pickupReviewReason: null,
        scheduleRevision: newRevision,
        updatedAt: new Date()
      },
      select: { id: true }
    });
    await tx.reservationScheduleChange.create({
      data: {
        reservationId: current.id,
        actorId: input.actorId,
        reason: input.reason,
        previousPickupStart: current.pickupStart,
        previousPickupEnd: current.pickupEnd,
        previousPolicyVersion: current.pickupPolicyVersion?.version ?? null,
        previousSlotLabel: current.pickupTimeSlot?.label ?? null,
        newPickupStart: selected.pickupStart,
        newPickupEnd: selected.pickupEnd,
        newPolicyVersion: selected.policy.version,
        newSlotLabel: selected.slot.label,
        previousScheduleRevision: current.scheduleRevision,
        newScheduleRevision: newRevision
      }
    });
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        action: "RESERVATION_PICKUP_RESCHEDULED",
        entityType: "reservation",
        entityId: current.id,
        summary: `Rescheduled pickup for reservation ${current.referenceCode}.`,
        metadata: {
          previousPickupStart: current.pickupStart?.toISOString() ?? null,
          previousPickupEnd: current.pickupEnd?.toISOString() ?? null,
          newPickupStart: selected.pickupStart.toISOString(),
          newPickupEnd: selected.pickupEnd.toISOString(),
          previousScheduleRevision: current.scheduleRevision,
          newScheduleRevision: newRevision,
          reason: input.reason
        }
      }
    });
    await tx.outboxEvent.create({
      data: {
        type: OUTBOX_EVENT_TYPES.reservationRescheduled,
        entityId: current.id,
        payload: {
          actorId: input.actorId,
          studentId: current.studentId,
          referenceCode: current.referenceCode,
          pickupStart: selected.pickupStart.toISOString(),
          pickupEnd: selected.pickupEnd.toISOString(),
          reason: input.reason
        }
      }
    });
    await publishRealtimeEvents(tx, [{
      topic: REALTIME_TOPICS.reservations,
      entityId: current.id,
      audienceUserIds: [current.studentId],
      audienceRoles: ["STAFF", "ADMIN"],
      payload: { action: "pickup-rescheduled", scheduleRevision: newRevision }
    }]);
    return current.id;
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 5_000,
    timeout: 12_000
  }).catch((error: unknown) => {
    if (error instanceof HttpError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      throw new HttpError(
        409,
        "The pickup schedule changed while it was being saved. Refresh and try again.",
        "RESERVATION_SCHEDULE_CONFLICT",
        { retryable: true }
      );
    }
    throw error;
  });
  wakeRealtimeBroker();
  return result;
}
