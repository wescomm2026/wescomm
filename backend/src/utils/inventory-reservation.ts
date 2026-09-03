import { type Prisma } from "@prisma/client";
import { HttpError } from "./http-error.js";

const ACTIVE_INVENTORY_RESERVATION_STATUSES = [
  "PENDING",
  "CONFIRMED",
  "READY_FOR_PICKUP"
] as const;

export async function requireNoActiveInventoryReservations(
  transaction: Prisma.TransactionClient,
  productId: string,
  error: { message: string; code: string }
) {
  const activeReservation = await transaction.reservationItem.findFirst({
    where: {
      productId,
      reservation: { status: { in: [...ACTIVE_INVENTORY_RESERVATION_STATUSES] } }
    },
    select: { id: true }
  });

  if (activeReservation) {
    throw new HttpError(409, error.message, error.code);
  }
}
