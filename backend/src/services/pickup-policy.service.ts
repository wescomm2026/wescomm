import { Prisma } from "@prisma/client";
import {
  addCalendarDays,
  manilaDateKey,
  pickupDateColumnKey,
  scheduleReviewReason,
  validatePickupSelection,
  type PickupPolicySnapshot
} from "../domain/pickup-schedule.js";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../utils/http-error.js";
import { OUTBOX_EVENT_TYPES } from "./outbox.service.js";
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
      sortOrder: true
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
  }>;
  closures: Array<{ date: string; reason: string }>;
};

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
  const today = manilaDateKey(now);
  return {
    id: policy.id,
    version: policy.version,
    timezone: policy.timezone,
    minAdvanceDays: policy.minAdvanceDays,
    maxAdvanceDays: policy.maxAdvanceDays,
    minDate: addCalendarDays(today, policy.minAdvanceDays),
    maxDate: addCalendarDays(today, policy.maxAdvanceDays),
    serverDate: today,
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
  now = new Date()
) {
  const policy = await requireCurrentPolicy(tx);
  const validated = validatePickupSelection({
    policy: asSnapshot(policy),
    policyVersion: input.pickupPolicyVersion,
    pickupDate: input.pickupDate,
    slotId: input.pickupSlotId,
    now
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

async function findAffectedReservations(
  client: Prisma.TransactionClient | typeof prisma,
  policy: PickupPolicySnapshot,
  now = new Date()
) {
  const rows = await client.reservation.findMany({
    where: {
      status: { in: ["PENDING", "CONFIRMED", "READY_FOR_PICKUP"] },
      pickupEnd: { gte: now }
    },
    select: {
      id: true,
      studentId: true,
      referenceCode: true,
      pickupStart: true,
      pickupEnd: true
    },
    orderBy: { pickupStart: "asc" }
  });

  return rows.flatMap((reservation) => {
    const reason = scheduleReviewReason({
      policy,
      pickupStart: reservation.pickupStart,
      pickupEnd: reservation.pickupEnd,
      now
    });
    return reason ? [{ ...reservation, reason }] : [];
  });
}

export async function previewPickupPolicy(input: PickupPolicyInput) {
  const current = await requireCurrentPolicy();
  const affected = await findAffectedReservations(prisma, inputSnapshot(input, current.version + 1));
  return {
    nextVersion: current.version + 1,
    affectedCount: affected.length,
    affectedReservations: affected.slice(0, 100).map((reservation) => ({
      id: reservation.id,
      referenceCode: reservation.referenceCode,
      pickupStart: reservation.pickupStart?.toISOString() ?? null,
      pickupEnd: reservation.pickupEnd?.toISOString() ?? null,
      reason: reservation.reason
    })),
    truncated: affected.length > 100
  };
}

export async function createPickupPolicyVersion(input: PickupPolicyInput, actorId: string) {
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('wescomm-pickup-policy'))`;
    const current = await requireCurrentPolicy(tx);
    const version = current.version + 1;
    const now = new Date();

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
        createdById: actorId,
        days: { create: input.days },
        timeSlots: {
          create: input.timeSlots.map((slot, index) => ({ ...slot, sortOrder: index }))
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
    const affectedByReason = affected.reduce((groups, reservation) => {
      const reservations = groups.get(reservation.reason) ?? [];
      reservations.push(reservation);
      groups.set(reservation.reason, reservations);
      return groups;
    }, new Map<string, typeof affected>());
    for (const [reason, reservations] of affectedByReason) {
      await tx.reservation.updateMany({
        where: { id: { in: reservations.map((reservation) => reservation.id) } },
        data: { pickupReviewStatus: "NEEDS_REVIEW", pickupReviewReason: reason, updatedAt: now }
      });
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
          closureCount: input.closures.length,
          affectedReservationCount: affected.length,
          reason: input.reason
        }
      }
    });

    await publishRealtimeEvents(tx, [{
      topic: REALTIME_TOPICS.reservations,
      entityId: policy.id,
      audienceRoles: ["STAFF", "ADMIN"],
      payload: { action: "pickup-policy-activated", version, affectedCount: affected.length }
    }]);
    return { policy: serializePolicy(policy, now), affectedCount: affected.length };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 5_000,
    timeout: 15_000
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

    const selected = await validatePickupSelectionInTransaction(tx, input);
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
  });
  wakeRealtimeBroker();
  return result;
}
