import { Prisma } from "@prisma/client";
import { HttpError } from "../utils/http-error.js";

export const ACTIVE_PICKUP_CAPACITY_STATUSES = ["PENDING", "CONFIRMED", "READY_FOR_PICKUP"] as const;

export type PickupSlotCapacity = {
  capacity?: number | null;
};

export function pickupWindowKey(pickupStart: Date, pickupEnd: Date) {
  return `${pickupStart.toISOString()}|${pickupEnd.toISOString()}`;
}

export function pickupCapacitySnapshot(capacity: number | null | undefined, booked: number) {
  const normalizedCapacity = capacity ?? null;
  return {
    capacity: normalizedCapacity,
    booked,
    remaining: normalizedCapacity === null ? null : Math.max(normalizedCapacity - booked, 0),
    isFull: normalizedCapacity !== null && booked >= normalizedCapacity
  };
}

export async function lockPickupWindowCapacity(
  tx: Prisma.TransactionClient,
  pickupStart: Date,
  pickupEnd: Date
) {
  const lockName = `wescomm-pickup-capacity:${pickupWindowKey(pickupStart, pickupEnd)}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockName}))`;
}

export async function getPickupWindowBookedCount(
  client: Prisma.TransactionClient,
  pickupStart: Date,
  pickupEnd: Date,
  excludeReservationId?: string
) {
  return client.reservation.count({
    where: {
      pickupStart,
      pickupEnd,
      status: { in: [...ACTIVE_PICKUP_CAPACITY_STATUSES] },
      ...(excludeReservationId ? { id: { not: excludeReservationId } } : {})
    }
  });
}

export async function assertPickupWindowCapacity(input: {
  tx: Prisma.TransactionClient;
  pickupStart: Date;
  pickupEnd: Date;
  slot: PickupSlotCapacity;
  excludeReservationId?: string;
}) {
  const capacity = input.slot.capacity ?? null;
  if (capacity === null) return pickupCapacitySnapshot(null, 0);

  await lockPickupWindowCapacity(input.tx, input.pickupStart, input.pickupEnd);
  const booked = await getPickupWindowBookedCount(
    input.tx,
    input.pickupStart,
    input.pickupEnd,
    input.excludeReservationId
  );
  const availability = pickupCapacitySnapshot(capacity, booked);
  if (availability.isFull) {
    throw new HttpError(
      409,
      "That pickup time just became full. Choose another available time.",
      "PICKUP_SLOT_FULL",
      availability
    );
  }
  return availability;
}
