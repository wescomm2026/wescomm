import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { createPage, decodeCursor, normalizePageLimit } from "../utils/cursor-pagination.js";
import { HttpError } from "../utils/http-error.js";
import { withTransientPrismaReadRetry } from "../utils/prisma-retry.js";
import { safelyRecordAuditLog } from "./audit-log.service.js";

type PageOptions = { cursor?: string; limit?: number };

async function requireStudent(studentId: string) {
  const student = await prisma.profile.findFirst({
    where: { id: studentId, role: "STUDENT" },
    select: {
      id: true,
      fullName: true,
      email: true,
      studentNumber: true,
      department: true,
      avatarUrl: true,
      createdAt: true,
      updatedAt: true
    }
  });
  if (!student) throw new HttpError(404, "Student not found.");
  return student;
}

export async function listOperationalStudents(options: PageOptions & { query?: string } = {}) {
  const limit = normalizePageLimit(options.limit);
  const cursorId = decodeCursor(options.cursor);
  const query = options.query?.trim();
  const where: Prisma.ProfileWhereInput = {
    role: "STUDENT",
    ...(query ? {
      OR: [
        { fullName: { contains: query, mode: "insensitive" } },
        { email: { contains: query, mode: "insensitive" } },
        { studentNumber: { contains: query, mode: "insensitive" } },
        { department: { contains: query, mode: "insensitive" } }
      ]
    } : {})
  };
  const rows = await withTransientPrismaReadRetry(() => prisma.profile.findMany({
    where,
    orderBy: [{ fullName: "asc" }, { id: "asc" }],
    ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    take: limit + 1,
    select: {
      id: true,
      fullName: true,
      email: true,
      studentNumber: true,
      department: true,
      avatarUrl: true,
      createdAt: true,
      _count: { select: { reservations: true, receipts: true, studentOffenses: true } },
      restrictions: {
        where: { status: "ACTIVE", OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] },
        take: 1,
        select: { id: true, level: true, endsAt: true }
      }
    }
  }));
  return createPage(rows.map((student) => ({
    id: student.id,
    fullName: student.fullName,
    email: student.email,
    studentNumber: student.studentNumber,
    department: student.department,
    avatarUrl: student.avatarUrl,
    createdAt: student.createdAt.toISOString(),
    reservationCount: student._count.reservations,
    receiptCount: student._count.receipts,
    offenseCount: student._count.studentOffenses,
    activeRestriction: student.restrictions[0]
      ? {
          id: student.restrictions[0].id,
          level: student.restrictions[0].level,
          endsAt: student.restrictions[0].endsAt?.toISOString() ?? null
        }
      : null
  })), limit);
}

export async function getOperationalStudentSummary(studentId: string, actorId: string) {
  const student = await requireStudent(studentId);
  const [reservationStatuses, receiptCount, activeRestriction, activeOffenseCount, scheduleChangeCount] = await Promise.all([
    prisma.reservation.groupBy({
      by: ["status"],
      where: { studentId },
      _count: { _all: true }
    }),
    prisma.receipt.count({ where: { studentId } }),
    prisma.accountRestriction.findFirst({
      where: { studentId, status: "ACTIVE", OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] },
      orderBy: [{ level: "desc" }, { createdAt: "desc" }],
      select: { id: true, level: true, source: true, reason: true, startsAt: true, endsAt: true }
    }),
    prisma.studentOffense.count({ where: { studentId, status: "ACTIVE" } }),
    prisma.reservationScheduleChange.count({ where: { reservation: { studentId } } })
  ]);

  const minuteKey = new Date().toISOString().slice(0, 16);
  await safelyRecordAuditLog({
    actorId,
    action: "STUDENT_OPERATIONAL_PROFILE_VIEWED",
    entityType: "user",
    entityId: studentId,
    dedupeKey: `student-profile-view:${actorId}:${studentId}:${minuteKey}`,
    summary: `Viewed the operational profile for ${student.fullName || student.email}.`,
    metadata: { studentId }
  });

  return {
    ...student,
    createdAt: student.createdAt.toISOString(),
    updatedAt: student.updatedAt.toISOString(),
    reservationCounts: Object.fromEntries(reservationStatuses.map((row) => [row.status, row._count._all])),
    receiptCount,
    activeOffenseCount,
    scheduleChangeCount,
    activeRestriction: activeRestriction ? {
      ...activeRestriction,
      startsAt: activeRestriction.startsAt.toISOString(),
      endsAt: activeRestriction.endsAt?.toISOString() ?? null
    } : null
  };
}

export async function listOperationalStudentReservations(studentId: string, options: PageOptions = {}) {
  await requireStudent(studentId);
  const limit = normalizePageLimit(options.limit);
  const cursorId = decodeCursor(options.cursor);
  const rows = await prisma.reservation.findMany({
    where: { studentId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    take: limit + 1,
    select: {
      id: true,
      referenceCode: true,
      status: true,
      pickupStart: true,
      pickupEnd: true,
      pickupReviewStatus: true,
      paymentMethod: true,
      totalAmount: true,
      createdAt: true,
      items: { select: { quantity: true, variantSummary: true, product: { select: { name: true } } } }
    }
  });
  return createPage(rows.map((reservation) => ({
    id: reservation.id,
    referenceCode: reservation.referenceCode,
    status: reservation.status,
    pickupStart: reservation.pickupStart?.toISOString() ?? null,
    pickupEnd: reservation.pickupEnd?.toISOString() ?? null,
    pickupReviewStatus: reservation.pickupReviewStatus,
    paymentMethod: reservation.paymentMethod,
    totalAmount: reservation.totalAmount.toString(),
    createdAt: reservation.createdAt.toISOString(),
    items: reservation.items.map((item) => ({
      name: item.product.name,
      quantity: item.quantity,
      variantSummary: item.variantSummary
    }))
  })), limit);
}

export async function listOperationalStudentReceipts(studentId: string, options: PageOptions = {}) {
  await requireStudent(studentId);
  const limit = normalizePageLimit(options.limit);
  const cursorId = decodeCursor(options.cursor);
  const rows = await prisma.receipt.findMany({
    where: { studentId },
    orderBy: [{ issuedAt: "desc" }, { id: "desc" }],
    ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    take: limit + 1,
    select: {
      id: true,
      receiptCode: true,
      status: true,
      totalAmount: true,
      paymentMethod: true,
      issuedAt: true,
      verifiedAt: true,
      voidedAt: true,
      reservation: { select: { referenceCode: true } }
    }
  });
  return createPage(rows.map((receipt) => ({
    id: receipt.id,
    receiptCode: receipt.receiptCode,
    status: receipt.status,
    totalAmount: receipt.totalAmount.toString(),
    paymentMethod: receipt.paymentMethod,
    issuedAt: receipt.issuedAt.toISOString(),
    verifiedAt: receipt.verifiedAt?.toISOString() ?? null,
    voidedAt: receipt.voidedAt?.toISOString() ?? null,
    reservationReference: receipt.reservation?.referenceCode ?? null
  })), limit);
}

export async function listOperationalStudentScheduleHistory(studentId: string, options: PageOptions = {}) {
  await requireStudent(studentId);
  const limit = normalizePageLimit(options.limit);
  const cursorId = decodeCursor(options.cursor);
  const rows = await prisma.reservationScheduleChange.findMany({
    where: { reservation: { studentId } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    take: limit + 1,
    select: {
      id: true,
      source: true,
      reason: true,
      previousPickupStart: true,
      previousPickupEnd: true,
      newPickupStart: true,
      newPickupEnd: true,
      previousSlotLabel: true,
      newSlotLabel: true,
      createdAt: true,
      reservation: { select: { id: true, referenceCode: true } },
      actor: { select: { id: true, fullName: true, email: true } }
    }
  });
  return createPage(rows.map((change) => ({
    id: change.id,
    source: change.source,
    reason: change.reason,
    previousPickupStart: change.previousPickupStart?.toISOString() ?? null,
    previousPickupEnd: change.previousPickupEnd?.toISOString() ?? null,
    newPickupStart: change.newPickupStart.toISOString(),
    newPickupEnd: change.newPickupEnd.toISOString(),
    previousSlotLabel: change.previousSlotLabel,
    newSlotLabel: change.newSlotLabel,
    createdAt: change.createdAt.toISOString(),
    reservation: change.reservation,
    actor: change.actor
  })), limit);
}

export async function listOperationalStudentRestrictions(studentId: string, options: PageOptions = {}) {
  await requireStudent(studentId);
  const limit = normalizePageLimit(options.limit);
  const cursorId = decodeCursor(options.cursor);
  const rows = await prisma.accountRestriction.findMany({
    where: { studentId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    take: limit + 1,
    select: {
      id: true,
      level: true,
      source: true,
      status: true,
      reason: true,
      startsAt: true,
      endsAt: true,
      liftedAt: true,
      liftReason: true,
      createdAt: true
    }
  });
  return createPage(rows.map((restriction) => ({
    ...restriction,
    startsAt: restriction.startsAt.toISOString(),
    endsAt: restriction.endsAt?.toISOString() ?? null,
    liftedAt: restriction.liftedAt?.toISOString() ?? null,
    createdAt: restriction.createdAt.toISOString()
  })), limit);
}

export async function listOperationalStudentOffenses(studentId: string, options: PageOptions = {}) {
  await requireStudent(studentId);
  const limit = normalizePageLimit(options.limit);
  const cursorId = decodeCursor(options.cursor);
  const rows = await prisma.studentOffense.findMany({
    where: { studentId },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    take: limit + 1,
    select: {
      id: true,
      type: true,
      status: true,
      reason: true,
      occurredAt: true,
      overturnedAt: true,
      overturnReason: true,
      reservation: { select: { id: true, referenceCode: true } }
    }
  });
  return createPage(rows.map((offense) => ({
    ...offense,
    occurredAt: offense.occurredAt.toISOString(),
    overturnedAt: offense.overturnedAt?.toISOString() ?? null
  })), limit);
}
