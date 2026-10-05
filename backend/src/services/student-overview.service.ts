import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { manilaMonthStart, summarizeReceiptCounts, summarizeReservationCounts } from "../domain/student-overview.js";
import { getPickupGuidance } from "./staff-settings.service.js";

const nextPickupSelect = {
  id: true,
  referenceCode: true,
  status: true,
  pickupStart: true,
  pickupEnd: true,
  pickupReviewStatus: true,
  totalAmount: true,
  pickupTimeSlot: { select: { label: true } },
  items: {
    select: { productNameSnapshot: true, quantity: true },
    orderBy: { id: "asc" },
    take: 3
  },
  _count: { select: { items: true } }
} satisfies Prisma.ReservationSelect;

type NextPickupRow = Prisma.ReservationGetPayload<{ select: typeof nextPickupSelect }>;

function mapNextPickup(row: NextPickupRow | null) {
  if (!row) return null;
  return {
    id: row.id,
    referenceCode: row.referenceCode,
    status: row.status,
    pickupStart: row.pickupStart?.toISOString() ?? null,
    pickupEnd: row.pickupEnd?.toISOString() ?? null,
    needsScheduleReview: row.pickupReviewStatus === "NEEDS_REVIEW",
    slotLabel: row.pickupTimeSlot?.label ?? null,
    totalAmount: Number(row.totalAmount),
    itemCount: row._count.items,
    items: row.items.map((item) => ({ name: item.productNameSnapshot, quantity: item.quantity }))
  };
}

/**
 * Everything the student home and profile need in one request. Counts and totals are
 * computed in the database, so they stay correct no matter how many records exist.
 */
export async function getStudentOverview(studentId: string, now = new Date()) {
  const soonestFirst: Prisma.ReservationOrderByWithRelationInput[] = [
    { pickupStart: { sort: "asc", nulls: "last" } },
    { id: "asc" }
  ];
  const [reservationGroups, readyNext, upcomingNext, receiptGroups, monthTotal, guidance] = await Promise.all([
    prisma.reservation.groupBy({ by: ["status"], where: { studentId }, _count: { _all: true } }),
    prisma.reservation.findFirst({
      where: { studentId, status: "READY_FOR_PICKUP" },
      orderBy: soonestFirst,
      select: nextPickupSelect
    }),
    prisma.reservation.findFirst({
      where: {
        studentId,
        status: { in: ["CONFIRMED", "PENDING"] },
        OR: [{ pickupEnd: null }, { pickupEnd: { gte: now } }]
      },
      orderBy: soonestFirst,
      select: nextPickupSelect
    }),
    prisma.receipt.groupBy({ by: ["status"], where: { studentId }, _count: { _all: true } }),
    prisma.receipt.aggregate({
      where: { studentId, status: { not: "VOIDED" }, issuedAt: { gte: manilaMonthStart(now) } },
      _sum: { totalAmount: true }
    }),
    getPickupGuidance().catch(() => null)
  ]);

  return {
    generatedAt: now.toISOString(),
    reservations: summarizeReservationCounts(reservationGroups),
    receipts: summarizeReceiptCounts(receiptGroups),
    spentThisMonth: Number(monthTotal._sum.totalAmount ?? 0),
    // A ready order is the most actionable thing to show, even if its window has started.
    nextPickup: mapNextPickup(readyNext ?? upcomingNext),
    pickupGuidance: guidance?.text ?? null
  };
}
