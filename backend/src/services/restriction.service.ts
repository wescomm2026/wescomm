import type { AppRole, Prisma } from "@prisma/client";
import {
  RESERVATION_RESTRICTION_POLICY,
  evaluateNoShowPolicy,
  getRestrictionEndDate
} from "../domain/reservation-policy.js";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../utils/http-error.js";
import { safelyRecordAuditLog } from "./audit-log.service.js";
import { createNotification } from "./notification.service.js";

export { RESERVATION_RESTRICTION_POLICY } from "../domain/reservation-policy.js";

export type ManualRestrictionDuration = "7_DAYS" | "30_DAYS" | "INDEFINITE";

export type NoShowPolicyOutcome = {
  studentId: string;
  offenseId: string;
  consecutiveOffenses: number;
  restriction: {
    id: string;
    level: number;
    endsAt: Date | null;
  } | null;
  notificationTitle: string;
  notificationMessage: string;
};

function restrictionDurationLabel(level: number, endsAt: Date | null) {
  if (level === 1) return "7 days";
  if (level === 2) return "30 days";
  return endsAt ? "temporarily" : "indefinitely pending admin review";
}

function mapRestriction(row: {
  id: string;
  studentId: string;
  offenseId: string | null;
  level: number;
  source: string;
  status: string;
  reason: string;
  startsAt: Date;
  endsAt: Date | null;
  createdById: string | null;
  liftedById: string | null;
  liftedAt: Date | null;
  liftReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    studentId: row.studentId,
    offenseId: row.offenseId,
    level: row.level,
    source: row.source,
    status: row.status,
    reason: row.reason,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt?.toISOString() ?? null,
    permanent: row.endsAt === null,
    createdById: row.createdById,
    liftedById: row.liftedById,
    liftedAt: row.liftedAt?.toISOString() ?? null,
    liftReason: row.liftReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function mapOffense(row: {
  id: string;
  studentId: string;
  reservationId: string | null;
  type: string;
  status: string;
  reason: string;
  occurredAt: Date;
  confirmedById: string | null;
  overturnedById: string | null;
  overturnedAt: Date | null;
  overturnReason: string | null;
  createdAt: Date;
  reservation?: { referenceCode: string } | null;
}) {
  return {
    id: row.id,
    studentId: row.studentId,
    reservationId: row.reservationId,
    reservationReference: row.reservation?.referenceCode ?? null,
    type: row.type,
    status: row.status,
    reason: row.reason,
    occurredAt: row.occurredAt.toISOString(),
    confirmedById: row.confirmedById,
    overturnedById: row.overturnedById,
    overturnedAt: row.overturnedAt?.toISOString() ?? null,
    overturnReason: row.overturnReason,
    createdAt: row.createdAt.toISOString()
  };
}

async function expireRestrictions(tx: Prisma.TransactionClient, studentId?: string) {
  await tx.accountRestriction.updateMany({
    where: {
      ...(studentId ? { studentId } : {}),
      status: "ACTIVE",
      endsAt: { lte: new Date() }
    },
    data: {
      status: "EXPIRED",
      updatedAt: new Date()
    }
  });
}

async function findActiveRestriction(tx: Prisma.TransactionClient, studentId: string) {
  await expireRestrictions(tx, studentId);
  return tx.accountRestriction.findFirst({
    where: {
      studentId,
      status: "ACTIVE",
      OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }]
    },
    orderBy: [{ level: "desc" }, { createdAt: "desc" }]
  });
}

async function consecutiveOffenseCount(tx: Prisma.TransactionClient, studentId: string) {
  const latestCompleted = await tx.reservation.findFirst({
    where: { studentId, status: "COMPLETED" },
    orderBy: { updatedAt: "desc" },
    select: { updatedAt: true }
  });

  return tx.studentOffense.count({
    where: {
      studentId,
      type: "NO_SHOW",
      status: "ACTIVE",
      ...(latestCompleted ? { occurredAt: { gt: latestCompleted.updatedAt } } : {})
    }
  });
}

export async function assertReservationAccessInTransaction(tx: Prisma.TransactionClient, studentId: string) {
  const restriction = await findActiveRestriction(tx, studentId);
  if (!restriction) return;

  const endMessage = restriction.endsAt
    ? ` until ${restriction.endsAt.toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric", timeZone: "Asia/Manila" })}`
    : " pending administrator review";

  throw new HttpError(
    403,
    `Your reservation access is suspended${endMessage}. You can still view receipts and contact Support.`,
    "RESERVATION_ACCESS_SUSPENDED",
    {
      restrictionId: restriction.id,
      level: restriction.level,
      reason: restriction.reason,
      startsAt: restriction.startsAt.toISOString(),
      endsAt: restriction.endsAt?.toISOString() ?? null,
      permanent: restriction.endsAt === null
    }
  );
}

export async function recordNoShowOffenseInTransaction(
  tx: Prisma.TransactionClient,
  input: { studentId: string; reservationId: string; referenceCode: string; confirmedById: string }
): Promise<NoShowPolicyOutcome> {
  const existing = await tx.studentOffense.findUnique({
    where: {
      reservationId_type: {
        reservationId: input.reservationId,
        type: "NO_SHOW"
      }
    }
  });
  if (existing) throw new HttpError(409, "This reservation already has a confirmed no-show offense.");

  const offense = await tx.studentOffense.create({
    data: {
      studentId: input.studentId,
      reservationId: input.reservationId,
      type: "NO_SHOW",
      reason: `Reservation ${input.referenceCode} was not collected after the pickup window and grace period.`,
      confirmedById: input.confirmedById
    }
  });

  const consecutiveOffenses = await consecutiveOffenseCount(tx, input.studentId);
  let restriction: NoShowPolicyOutcome["restriction"] = null;
  let notificationTitle = "Reservation no-show warning";
  let notificationMessage = `${input.referenceCode} was recorded as an unclaimed reservation. This is warning ${consecutiveOffenses} of 3 before reservation access is suspended.`;

  const activeRestriction = consecutiveOffenses >= RESERVATION_RESTRICTION_POLICY.firstRestrictionAt
    ? await findActiveRestriction(tx, input.studentId)
    : null;
  const highestPreviousRestriction = consecutiveOffenses >= RESERVATION_RESTRICTION_POLICY.firstRestrictionAt && !activeRestriction
    ? await tx.accountRestriction.findFirst({
        where: { studentId: input.studentId, source: "AUTOMATIC" },
        orderBy: { level: "desc" },
        select: { level: true }
      })
    : null;
  const decision = evaluateNoShowPolicy({
    consecutiveOffenses,
    highestPreviousRestrictionLevel: highestPreviousRestriction?.level ?? 0,
    hasActiveRestriction: Boolean(activeRestriction)
  });

  if (decision.kind === "WARNING" && decision.warningNumber === 2) {
    notificationTitle = "Final reservation warning";
    notificationMessage = `${input.referenceCode} was recorded as unclaimed. Another consecutive no-show may suspend your reservation access.`;
  }

  if (decision.kind === "KEEP_ACTIVE_RESTRICTION" && activeRestriction) {
      notificationTitle = "Additional reservation no-show recorded";
      notificationMessage = `${input.referenceCode} was recorded as unclaimed. Your existing reservation restriction remains in effect; this review did not start a second overlapping suspension.`;

    return {
      studentId: input.studentId,
      offenseId: offense.id,
      consecutiveOffenses,
      restriction: {
        id: activeRestriction.id,
        level: activeRestriction.level,
        endsAt: activeRestriction.endsAt
      },
      notificationTitle,
      notificationMessage
    };
  }

  if (decision.kind === "CREATE_RESTRICTION") {
    const level = decision.level;
    const startsAt = new Date();
    const endsAt = getRestrictionEndDate(level, startsAt);
    const createdRestriction = await tx.accountRestriction.create({
      data: {
        studentId: input.studentId,
        offenseId: offense.id,
        level,
        source: "AUTOMATIC",
        reason: level === 3
          ? "Repeated unclaimed reservations require administrator review."
          : `${consecutiveOffenses} consecutive confirmed reservation no-shows.`,
        startsAt,
        endsAt,
        createdById: input.confirmedById
      }
    });

    restriction = {
      id: createdRestriction.id,
      level: createdRestriction.level,
      endsAt: createdRestriction.endsAt
    };
    notificationTitle = level === 3 ? "Reservation access suspended for review" : "Reservation access temporarily suspended";
    notificationMessage = `Your reservation access is suspended ${restrictionDurationLabel(level, endsAt)} because of repeated confirmed no-shows. You can still view receipts and contact Support.`;
  }

  return {
    studentId: input.studentId,
    offenseId: offense.id,
    consecutiveOffenses,
    restriction,
    notificationTitle,
    notificationMessage
  };
}

export async function notifyStudentOfPolicyOutcome(outcome: NoShowPolicyOutcome) {
  try {
    await createNotification({
      userId: outcome.studentId,
      type: "SYSTEM",
      title: outcome.notificationTitle,
      message: outcome.notificationMessage
    });
  } catch (error) {
    console.warn("Unable to create restriction notification:", error instanceof Error ? error.message : error);
  }
}

export async function getStudentRestrictionSummary(studentId: string) {
  return prisma.$transaction(async (tx) => {
    const activeRestriction = await findActiveRestriction(tx, studentId);
    const [offenses, restrictions, consecutiveOffenses] = await Promise.all([
      tx.studentOffense.findMany({
        where: { studentId },
        include: { reservation: { select: { referenceCode: true } } },
        orderBy: { occurredAt: "desc" },
        take: 20
      }),
      tx.accountRestriction.findMany({
        where: { studentId },
        orderBy: { createdAt: "desc" },
        take: 20
      }),
      consecutiveOffenseCount(tx, studentId)
    ]);

    return {
      policy: RESERVATION_RESTRICTION_POLICY,
      activeRestriction: activeRestriction ? mapRestriction(activeRestriction) : null,
      consecutiveOffenses,
      nextWarningAt: RESERVATION_RESTRICTION_POLICY.firstRestrictionAt,
      offenses: offenses.map(mapOffense),
      restrictions: restrictions.map(mapRestriction)
    };
  });
}

export async function listRestrictionOverview(filters: { query?: string; status?: "ALL" | "RESTRICTED" | "CLEAR" } = {}) {
  return prisma.$transaction(async (tx) => {
    await expireRestrictions(tx);
    const cutoff = new Date(Date.now() - RESERVATION_RESTRICTION_POLICY.noShowGraceHours * 60 * 60 * 1000);
    const students = await tx.profile.findMany({
      where: {
        role: "STUDENT",
        ...(filters.query
          ? {
              OR: [
                { fullName: { contains: filters.query, mode: "insensitive" } },
                { email: { contains: filters.query, mode: "insensitive" } },
                { studentNumber: { contains: filters.query, mode: "insensitive" } }
              ]
            }
          : {})
      },
      orderBy: [{ fullName: "asc" }, { email: "asc" }],
      take: 200,
      select: {
        id: true,
        fullName: true,
        email: true,
        studentNumber: true,
        department: true,
        restrictions: {
          where: { status: "ACTIVE", OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] },
          orderBy: [{ level: "desc" }, { createdAt: "desc" }],
          take: 1
        },
        studentOffenses: {
          include: { reservation: { select: { referenceCode: true } } },
          orderBy: { occurredAt: "desc" },
          take: 10
        },
        reservations: {
          where: { status: "COMPLETED" },
          orderBy: { updatedAt: "desc" },
          take: 1,
          select: { updatedAt: true }
        }
      }
    });

    const mappedStudents = students.map((student) => {
      const latestCompletedAt = student.reservations[0]?.updatedAt;
      const consecutiveOffenses = student.studentOffenses.filter(
        (offense) => offense.type === "NO_SHOW" && offense.status === "ACTIVE" && (!latestCompletedAt || offense.occurredAt > latestCompletedAt)
      ).length;
      return {
        id: student.id,
        fullName: student.fullName,
        email: student.email,
        studentNumber: student.studentNumber,
        department: student.department,
        activeRestriction: student.restrictions[0] ? mapRestriction(student.restrictions[0]) : null,
        consecutiveOffenses,
        offenses: student.studentOffenses.map(mapOffense)
      };
    });

    const filteredStudents = mappedStudents.filter((student) => {
      if (filters.status === "RESTRICTED") return Boolean(student.activeRestriction);
      if (filters.status === "CLEAR") return !student.activeRestriction;
      return true;
    });

    const candidates = await tx.reservation.findMany({
      where: {
        status: "READY_FOR_PICKUP",
        pickupEnd: { not: null, lte: cutoff }
      },
      orderBy: { pickupEnd: "asc" },
      take: 100,
      select: {
        id: true,
        referenceCode: true,
        studentId: true,
        pickupEnd: true,
        student: { select: { fullName: true, email: true, studentNumber: true } },
        items: { select: { quantity: true, product: { select: { name: true } } } }
      }
    });

    return {
      policy: RESERVATION_RESTRICTION_POLICY,
      students: filteredStudents,
      noShowCandidates: candidates.map((reservation) => ({
        id: reservation.id,
        referenceCode: reservation.referenceCode,
        studentId: reservation.studentId,
        student: reservation.student,
        pickupEnd: reservation.pickupEnd?.toISOString() ?? null,
        eligibleSince: reservation.pickupEnd
          ? new Date(reservation.pickupEnd.getTime() + RESERVATION_RESTRICTION_POLICY.noShowGraceHours * 60 * 60 * 1000).toISOString()
          : null,
        items: reservation.items.map((item) => ({ name: item.product.name, quantity: item.quantity }))
      }))
    };
  });
}

export async function createManualRestriction(input: {
  studentId: string;
  duration: ManualRestrictionDuration;
  reason: string;
  createdById: string;
  actorRole: AppRole;
}) {
  if (input.duration === "INDEFINITE" && input.actorRole !== "ADMIN") {
    throw new HttpError(403, "Only administrators can apply an indefinite restriction.");
  }

  const level = input.duration === "7_DAYS" ? 1 : input.duration === "30_DAYS" ? 2 : 3;
  const startsAt = new Date();
  const endsAt = getRestrictionEndDate(level, startsAt);

  const restriction = await prisma.$transaction(async (tx) => {
    const student = await tx.profile.findFirst({
      where: { id: input.studentId, role: "STUDENT" },
      select: { id: true, email: true }
    });
    if (!student) throw new HttpError(404, "Student account not found.");

    const existing = await findActiveRestriction(tx, input.studentId);
    if (existing) throw new HttpError(409, "This student already has an active reservation restriction.");

    return tx.accountRestriction.create({
      data: {
        studentId: input.studentId,
        level,
        source: "MANUAL",
        reason: input.reason.trim(),
        startsAt,
        endsAt,
        createdById: input.createdById
      }
    });
  });

  await notifyStudentOfPolicyOutcome({
    studentId: input.studentId,
    offenseId: "",
    consecutiveOffenses: 0,
    restriction: { id: restriction.id, level, endsAt },
    notificationTitle: level === 3 ? "Reservation access suspended for review" : "Reservation access temporarily suspended",
    notificationMessage: `Your reservation access was suspended ${restrictionDurationLabel(level, endsAt)}. Reason: ${restriction.reason}. You can contact Support for assistance.`
  });

  await safelyRecordAuditLog({
    actorId: input.createdById,
    action: "STUDENT_RESTRICTION_CREATED",
    entityType: "account_restriction",
    entityId: restriction.id,
    summary: `Applied a level ${level} reservation restriction to ${input.studentId}.`,
    metadata: { studentId: input.studentId, level, duration: input.duration, reason: restriction.reason }
  });

  return mapRestriction(restriction);
}

export async function liftRestriction(input: {
  restrictionId: string;
  reason: string;
  liftedById: string;
  actorRole: AppRole;
}) {
  const result = await prisma.$transaction(async (tx) => {
    const restriction = await tx.accountRestriction.findUnique({
      where: { id: input.restrictionId },
      include: { student: { select: { id: true, email: true } } }
    });
    if (!restriction) throw new HttpError(404, "Restriction not found.");
    if (restriction.status !== "ACTIVE") throw new HttpError(409, "This restriction is no longer active.");
    if (restriction.level === 3 && input.actorRole !== "ADMIN") {
      throw new HttpError(403, "Only administrators can lift an indefinite restriction.");
    }

    const updated = await tx.accountRestriction.update({
      where: { id: restriction.id },
      data: {
        status: "LIFTED",
        liftedById: input.liftedById,
        liftedAt: new Date(),
        liftReason: input.reason.trim(),
        updatedAt: new Date()
      }
    });
    return { updated, studentId: restriction.student.id };
  });

  try {
    await createNotification({
      userId: result.studentId,
      type: "SYSTEM",
      title: "Reservation access restored",
      message: "Your WESCOMM reservation access has been restored. Please review pickup schedules carefully before reserving."
    });
  } catch (error) {
    console.warn("Unable to create restriction-lift notification:", error instanceof Error ? error.message : error);
  }

  await safelyRecordAuditLog({
    actorId: input.liftedById,
    action: "STUDENT_RESTRICTION_LIFTED",
    entityType: "account_restriction",
    entityId: result.updated.id,
    summary: `Lifted reservation restriction ${result.updated.id}.`,
    metadata: { studentId: result.studentId, reason: input.reason }
  });

  return mapRestriction(result.updated);
}

export async function overturnOffense(input: { offenseId: string; reason: string; overturnedById: string }) {
  const result = await prisma.$transaction(async (tx) => {
    const offense = await tx.studentOffense.findUnique({
      where: { id: input.offenseId },
      include: { restriction: true }
    });
    if (!offense) throw new HttpError(404, "Offense not found.");
    if (offense.status === "OVERTURNED") throw new HttpError(409, "This offense was already overturned.");

    const updatedOffense = await tx.studentOffense.update({
      where: { id: offense.id },
      data: {
        status: "OVERTURNED",
        overturnedById: input.overturnedById,
        overturnedAt: new Date(),
        overturnReason: input.reason.trim()
      },
      include: { reservation: { select: { referenceCode: true } } }
    });

    if (offense.restriction?.status === "ACTIVE") {
      await tx.accountRestriction.update({
        where: { id: offense.restriction.id },
        data: {
          status: "LIFTED",
          liftedById: input.overturnedById,
          liftedAt: new Date(),
          liftReason: `Offense overturned: ${input.reason.trim()}`,
          updatedAt: new Date()
        }
      });
    }

    return updatedOffense;
  });

  try {
    await createNotification({
      userId: result.studentId,
      type: "SYSTEM",
      title: "Reservation offense removed",
      message: "A reservation offense was overturned after review. Any linked active restriction has been lifted."
    });
  } catch (error) {
    console.warn("Unable to create offense-overturn notification:", error instanceof Error ? error.message : error);
  }

  await safelyRecordAuditLog({
    actorId: input.overturnedById,
    action: "STUDENT_OFFENSE_OVERTURNED",
    entityType: "student_offense",
    entityId: result.id,
    summary: `Overturned reservation offense ${result.id}.`,
    metadata: { studentId: result.studentId, reason: input.reason }
  });

  return mapOffense(result);
}
