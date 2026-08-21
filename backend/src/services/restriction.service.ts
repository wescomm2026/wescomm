import type { AppRole, Prisma } from "@prisma/client";
import {
  RESERVATION_RESTRICTION_POLICY,
  evaluateNoShowPolicy,
  getRestrictionEndDate
} from "../domain/reservation-policy.js";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../utils/http-error.js";
import {
  assertSingleRestrictionMutation,
  runRestrictionReadTransaction,
  runRestrictionWriteTransaction
} from "../utils/restriction-transaction.js";
import { createPage, decodeCursor, normalizePageLimit } from "../utils/cursor-pagination.js";
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

async function expireRestrictions(tx: Prisma.TransactionClient, studentId?: string, now = new Date()) {
  await tx.accountRestriction.updateMany({
    where: {
      ...(studentId ? { studentId } : {}),
      status: "ACTIVE",
      endsAt: { lte: now }
    },
    data: {
      status: "EXPIRED",
      updatedAt: now
    }
  });
}

async function findActiveRestriction(tx: Prisma.TransactionClient, studentId: string, now = new Date()) {
  await expireRestrictions(tx, studentId, now);
  return tx.accountRestriction.findFirst({
    where: {
      studentId,
      status: "ACTIVE",
      OR: [{ endsAt: null }, { endsAt: { gt: now } }]
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
  return runRestrictionReadTransaction(prisma, async (tx) => {
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

export async function listRestrictionOverview(filters: {
  query?: string;
  status?: "ALL" | "RESTRICTED" | "CLEAR";
  cursor?: string;
  limit?: number;
} = {}) {
  return runRestrictionReadTransaction(prisma, async (tx) => {
    const now = new Date();
    const limit = normalizePageLimit(filters.limit);
    const cursorId = decodeCursor(filters.cursor);
    await expireRestrictions(tx, undefined, now);
    const activeRestrictionWhere: Prisma.AccountRestrictionWhereInput = {
      status: "ACTIVE",
      OR: [{ endsAt: null }, { endsAt: { gt: now } }]
    };
    const restrictionStatusWhere: Prisma.ProfileWhereInput = filters.status === "RESTRICTED"
      ? { restrictions: { some: activeRestrictionWhere } }
      : filters.status === "CLEAR"
        ? { restrictions: { none: activeRestrictionWhere } }
        : {};
    const students = await tx.profile.findMany({
      where: {
        role: "STUDENT",
        ...restrictionStatusWhere,
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
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      take: limit + 1,
      select: {
        id: true,
        fullName: true,
        email: true,
        studentNumber: true,
        department: true,
        restrictions: {
          where: activeRestrictionWhere,
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

    const [totalStudents, restrictedStudents, warningRows] = await Promise.all([
      tx.profile.count({ where: { role: "STUDENT" } }),
      tx.profile.count({
        where: {
          role: "STUDENT",
          restrictions: { some: activeRestrictionWhere }
        }
      }),
      tx.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) AS "count"
        FROM "profiles" profile
        WHERE profile."role" = 'STUDENT'
          AND NOT EXISTS (
            SELECT 1
            FROM "account_restrictions" restriction
            WHERE restriction."student_id" = profile."id"
              AND restriction."status" = 'ACTIVE'
              AND (restriction."ends_at" IS NULL OR restriction."ends_at" > ${now})
          )
          AND EXISTS (
            SELECT 1
            FROM "student_offenses" offense
            WHERE offense."student_id" = profile."id"
              AND offense."type" = 'NO_SHOW'
              AND offense."status" = 'ACTIVE'
              AND offense."occurred_at" > COALESCE((
                SELECT MAX(reservation."updated_at")
                FROM "reservations" reservation
                WHERE reservation."student_id" = profile."id"
                  AND reservation."status" = 'COMPLETED'
              ), '-infinity'::timestamptz)
          )
      `
    ]);

    const studentPage = createPage(students, limit);
    const studentIds = studentPage.items.map((student) => student.id);
    const activeNoShowOffenses = studentIds.length > 0
      ? await tx.studentOffense.findMany({
          where: {
            studentId: { in: studentIds },
            type: "NO_SHOW",
            status: "ACTIVE"
          },
          select: { studentId: true, occurredAt: true }
        })
      : [];
    const latestCompletedAtByStudent = new Map(
      students.map((student) => [student.id, student.reservations[0]?.updatedAt] as const)
    );
    const consecutiveOffenseCountByStudent = new Map<string, number>();

    for (const offense of activeNoShowOffenses) {
      const latestCompletedAt = latestCompletedAtByStudent.get(offense.studentId);
      if (latestCompletedAt && offense.occurredAt <= latestCompletedAt) continue;
      consecutiveOffenseCountByStudent.set(
        offense.studentId,
        (consecutiveOffenseCountByStudent.get(offense.studentId) ?? 0) + 1
      );
    }

    const mappedStudents = studentPage.items.map((student) => {
      return {
        id: student.id,
        fullName: student.fullName,
        email: student.email,
        studentNumber: student.studentNumber,
        department: student.department,
        activeRestriction: student.restrictions[0] ? mapRestriction(student.restrictions[0]) : null,
        consecutiveOffenses: consecutiveOffenseCountByStudent.get(student.id) ?? 0,
        offenses: student.studentOffenses.map(mapOffense)
      };
    });

    return {
      policy: RESERVATION_RESTRICTION_POLICY,
      students: mappedStudents,
      nextCursor: studentPage.nextCursor,
      summary: {
        totalStudents,
        restrictedStudents,
        warningStudents: Number(warningRows[0]?.count ?? 0n)
      }
    };
  });
}

export async function listNoShowCandidates(filters: {
  query?: string;
  cursor?: string;
  limit?: number;
} = {}) {
  return runRestrictionReadTransaction(prisma, async (tx) => {
    const now = new Date();
    const cutoff = new Date(now.getTime() - RESERVATION_RESTRICTION_POLICY.noShowGraceHours * 60 * 60 * 1000);
    const limit = normalizePageLimit(filters.limit);
    const cursorId = decodeCursor(filters.cursor);
    const where: Prisma.ReservationWhereInput = {
      status: "READY_FOR_PICKUP",
      pickupEnd: { not: null, lte: cutoff },
      ...(filters.query?.trim()
        ? {
            OR: [
              { referenceCode: { contains: filters.query.trim(), mode: "insensitive" } },
              { student: { fullName: { contains: filters.query.trim(), mode: "insensitive" } } },
              { student: { email: { contains: filters.query.trim(), mode: "insensitive" } } },
              { student: { studentNumber: { contains: filters.query.trim(), mode: "insensitive" } } },
              { items: { some: { product: { name: { contains: filters.query.trim(), mode: "insensitive" } } } } }
            ]
          }
        : {})
    };
    const [candidates, totalCandidates] = await Promise.all([
      tx.reservation.findMany({
      where: {
        ...where
      },
      orderBy: [{ pickupEnd: "asc" }, { id: "asc" }],
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      take: limit + 1,
      select: {
        id: true,
        referenceCode: true,
        studentId: true,
        pickupEnd: true,
        student: { select: { fullName: true, email: true, studentNumber: true } },
        items: { select: { quantity: true, product: { select: { name: true } } } }
      }
      }),
      tx.reservation.count({ where })
    ]);

    const page = createPage(candidates, limit);

    return {
      items: page.items.map((reservation) => ({
        id: reservation.id,
        referenceCode: reservation.referenceCode,
        studentId: reservation.studentId,
        student: reservation.student,
        pickupEnd: reservation.pickupEnd?.toISOString() ?? null,
        eligibleSince: reservation.pickupEnd
          ? new Date(reservation.pickupEnd.getTime() + RESERVATION_RESTRICTION_POLICY.noShowGraceHours * 60 * 60 * 1000).toISOString()
          : null,
        items: reservation.items.map((item) => ({ name: item.product.name, quantity: item.quantity }))
      })),
      nextCursor: page.nextCursor,
      totalCandidates
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

  const restriction = await runRestrictionWriteTransaction(prisma, async (tx) => {
    const student = await tx.profile.findFirst({
      where: { id: input.studentId, role: "STUDENT" },
      select: { id: true, email: true }
    });
    if (!student) throw new HttpError(404, "Student account not found.");

    const existing = await findActiveRestriction(tx, input.studentId);
    if (existing) {
      throw new HttpError(
        409,
        "This student already has an active reservation restriction.",
        "ACTIVE_RESTRICTION_EXISTS"
      );
    }

    const startsAt = new Date();
    const endsAt = getRestrictionEndDate(level, startsAt);
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
    restriction: { id: restriction.id, level: restriction.level, endsAt: restriction.endsAt },
    notificationTitle: restriction.level === 3 ? "Reservation access suspended for review" : "Reservation access temporarily suspended",
    notificationMessage: `Your reservation access was suspended ${restrictionDurationLabel(restriction.level, restriction.endsAt)}. Reason: ${restriction.reason}. You can contact Support for assistance.`
  });

  await safelyRecordAuditLog({
    actorId: input.createdById,
    action: "STUDENT_RESTRICTION_CREATED",
    entityType: "account_restriction",
    entityId: restriction.id,
    summary: `Applied a level ${restriction.level} reservation restriction to ${input.studentId}.`,
    metadata: { studentId: input.studentId, level: restriction.level, duration: input.duration, reason: restriction.reason }
  });

  return mapRestriction(restriction);
}

export async function liftRestriction(input: {
  restrictionId: string;
  reason: string;
  liftedById: string;
  actorRole: AppRole;
}) {
  const result = await runRestrictionWriteTransaction(prisma, async (tx) => {
    const restriction = await tx.accountRestriction.findUnique({
      where: { id: input.restrictionId },
      include: { student: { select: { id: true, email: true } } }
    });
    if (!restriction) throw new HttpError(404, "Restriction not found.");
    if (restriction.status !== "ACTIVE") {
      throw new HttpError(409, "This restriction is no longer active.", "RESTRICTION_ALREADY_INACTIVE");
    }
    if (restriction.level === 3 && input.actorRole !== "ADMIN") {
      throw new HttpError(403, "Only administrators can lift an indefinite restriction.");
    }

    const mutation = await tx.accountRestriction.updateMany({
      where: { id: restriction.id, status: "ACTIVE" },
      data: {
        status: "LIFTED",
        liftedById: input.liftedById,
        liftedAt: new Date(),
        liftReason: input.reason.trim(),
        updatedAt: new Date()
      }
    });
    assertSingleRestrictionMutation(
      mutation,
      "This restriction is no longer active.",
      "RESTRICTION_ALREADY_INACTIVE"
    );

    const updated = await tx.accountRestriction.findUnique({ where: { id: restriction.id } });
    if (!updated) throw new HttpError(404, "Restriction not found.");
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
  const result = await runRestrictionWriteTransaction(prisma, async (tx) => {
    const offense = await tx.studentOffense.findUnique({
      where: { id: input.offenseId },
      include: { restriction: true }
    });
    if (!offense) throw new HttpError(404, "Offense not found.");
    if (offense.status === "OVERTURNED") {
      throw new HttpError(409, "This offense was already overturned.", "OFFENSE_ALREADY_OVERTURNED");
    }

    const offenseMutation = await tx.studentOffense.updateMany({
      where: { id: offense.id, status: "ACTIVE" },
      data: {
        status: "OVERTURNED",
        overturnedById: input.overturnedById,
        overturnedAt: new Date(),
        overturnReason: input.reason.trim()
      }
    });
    assertSingleRestrictionMutation(
      offenseMutation,
      "This offense was already overturned.",
      "OFFENSE_ALREADY_OVERTURNED"
    );

    if (offense.restriction?.status === "ACTIVE") {
      await tx.accountRestriction.updateMany({
        where: { id: offense.restriction.id, status: "ACTIVE" },
        data: {
          status: "LIFTED",
          liftedById: input.overturnedById,
          liftedAt: new Date(),
          liftReason: `Offense overturned: ${input.reason.trim()}`,
          updatedAt: new Date()
        }
      });
    }

    const updatedOffense = await tx.studentOffense.findUnique({
      where: { id: offense.id },
      include: { reservation: { select: { referenceCode: true } } }
    });
    if (!updatedOffense) throw new HttpError(404, "Offense not found.");
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
