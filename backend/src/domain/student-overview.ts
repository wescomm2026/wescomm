import type { ReceiptStatus, ReservationStatus } from "@prisma/client";

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

export type StudentReservationCounts = Record<ReservationStatus, number> & {
  total: number;
  active: number;
};

export type StudentReceiptCounts = Record<ReceiptStatus, number> & { total: number };

const RESERVATION_STATUSES: ReservationStatus[] = ["PENDING", "CONFIRMED", "READY_FOR_PICKUP", "COMPLETED", "CANCELLED", "NO_SHOW"];
const RECEIPT_STATUSES: ReceiptStatus[] = ["PENDING", "VERIFIED", "VOIDED"];
const ACTIVE_RESERVATION_STATUSES: ReservationStatus[] = ["PENDING", "CONFIRMED", "READY_FOR_PICKUP"];

// The first instant of the current calendar month in Asia/Manila (UTC+8, no daylight saving).
export function manilaMonthStart(now: Date) {
  const manila = new Date(now.getTime() + MANILA_OFFSET_MS);
  return new Date(Date.UTC(manila.getUTCFullYear(), manila.getUTCMonth(), 1) - MANILA_OFFSET_MS);
}

export function summarizeReservationCounts(groups: Array<{ status: ReservationStatus; _count: { _all: number } }>): StudentReservationCounts {
  const counts = Object.fromEntries(RESERVATION_STATUSES.map((status) => [status, 0])) as Record<ReservationStatus, number>;
  for (const group of groups) counts[group.status] = group._count._all;
  const total = RESERVATION_STATUSES.reduce((sum, status) => sum + counts[status], 0);
  const active = ACTIVE_RESERVATION_STATUSES.reduce((sum, status) => sum + counts[status], 0);
  return { ...counts, total, active };
}

export function summarizeReceiptCounts(groups: Array<{ status: ReceiptStatus; _count: { _all: number } }>): StudentReceiptCounts {
  const counts = Object.fromEntries(RECEIPT_STATUSES.map((status) => [status, 0])) as Record<ReceiptStatus, number>;
  for (const group of groups) counts[group.status] = group._count._all;
  return { ...counts, total: RECEIPT_STATUSES.reduce((sum, status) => sum + counts[status], 0) };
}
