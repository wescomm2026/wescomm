import { Prisma, type AppRole as PrismaAppRole } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { safelyRecordAuditLog, type AuditLogInput } from "./audit-log.service.js";
import type { AppRole } from "../types/app.js";
import { HttpError } from "../utils/http-error.js";
import { decryptSensitiveText } from "../utils/field-encryption.js";
import { withTransientPrismaReadRetry } from "../utils/prisma-retry.js";

const ADMIN_ROLE_LOCK_NAMESPACE = 1_464_161_091;
const ADMIN_ROLE_LOCK_KEY = 1;

export const USER_ROLE_UPDATE_TRANSACTION_OPTIONS = Object.freeze({
  maxWait: 10_000,
  timeout: 20_000
});

export type UserRoleUpdateTransaction = Pick<Prisma.TransactionClient, "$queryRaw"> & {
  profile: Pick<Prisma.TransactionClient["profile"], "findUnique" | "count" | "update">;
};

export type UserRoleUpdateDependencies = {
  runTransaction: <T>(operation: (transaction: UserRoleUpdateTransaction) => Promise<T>) => Promise<T>;
  recordAuditLog: (input: AuditLogInput) => Promise<unknown>;
};

function mapUser(row: {
  id: string;
  fullName: string;
  email: string;
  studentNumber: string | null;
  phone: string | null;
  department: string | null;
  role: PrismaAppRole;
  avatarUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    fullName: row.fullName,
    email: row.email,
    studentNumber: row.studentNumber,
    phone: decryptSensitiveText(row.phone, "profile.phone"),
    department: row.department,
    role: row.role,
    avatarUrl: row.avatarUrl,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

export async function listUsers() {
  const users = await withTransientPrismaReadRetry(() => prisma.profile.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      fullName: true,
      email: true,
      studentNumber: true,
      phone: true,
      department: true,
      role: true,
      avatarUrl: true,
      createdAt: true,
      updatedAt: true
    }
  }));

  return users.map(mapUser);
}

export async function listStaffVisibleUsers() {
  const users = await withTransientPrismaReadRetry(() => prisma.profile.findMany({
    where: {
      role: { in: ["STAFF", "ADMIN"] }
    },
    orderBy: [
      { role: "asc" },
      { fullName: "asc" }
    ],
    select: {
      id: true,
      fullName: true,
      email: true,
      studentNumber: true,
      phone: true,
      department: true,
      role: true,
      avatarUrl: true,
      createdAt: true,
      updatedAt: true
    }
  }));

  return users.map(mapUser);
}

export async function updateUserRoleWithDependencies(
  userId: string,
  role: AppRole,
  performedById: string,
  dependencies: UserRoleUpdateDependencies
) {
  const result = await dependencies.runTransaction(async (transaction) => {
    // All role mutations share one transaction-scoped lock. In particular,
    // two admins cannot both pass the last-admin count before either demotion
    // commits. The lock is released automatically on commit or rollback and is
    // safe with transaction-pooled PostgreSQL connections.
    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(
        CAST(${ADMIN_ROLE_LOCK_NAMESPACE} AS integer),
        CAST(${ADMIN_ROLE_LOCK_KEY} AS integer)
      )
    `;

    const existingUser = await transaction.profile.findUnique({
      where: { id: userId },
      select: { id: true, role: true }
    });

    if (!existingUser) throw new HttpError(404, "User not found.");
    if (userId === performedById && role !== "ADMIN") {
      throw new HttpError(400, "You cannot remove your own admin access.");
    }

    if (existingUser.role === "ADMIN" && role !== "ADMIN") {
      const adminCount = await transaction.profile.count({ where: { role: "ADMIN" } });
      if (adminCount <= 1) throw new HttpError(400, "At least one admin account is required.");
    }

    // Middleware authorization may have happened before this request waited on
    // the advisory lock. Re-read the actor under the lock so a concurrently
    // demoted admin cannot apply another role change with stale authority.
    const actingUser = userId === performedById
      ? existingUser
      : await transaction.profile.findUnique({
        where: { id: performedById },
        select: { id: true, role: true }
      });
    if (!actingUser || actingUser.role !== "ADMIN") {
      throw new HttpError(403, "You do not have access to this resource.");
    }

    const user = await transaction.profile.update({
      where: { id: userId },
      data: {
        role,
        updatedAt: new Date()
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        studentNumber: true,
        phone: true,
        department: true,
        role: true,
        avatarUrl: true,
        createdAt: true,
        updatedAt: true
      }
    });

    return {
      mappedUser: mapUser(user),
      previousRole: existingUser.role
    };
  });

  await dependencies.recordAuditLog({
    actorId: performedById,
    action: "USER_ROLE_UPDATED",
    entityType: "user",
    entityId: userId,
    summary: `Updated ${result.mappedUser.email} role from ${result.previousRole} to ${result.mappedUser.role}.`,
    metadata: {
      email: result.mappedUser.email,
      previousRole: result.previousRole,
      nextRole: result.mappedUser.role
    }
  });

  return result.mappedUser;
}

const userRoleUpdateDependencies: UserRoleUpdateDependencies = {
  runTransaction: (operation) => prisma.$transaction(
    (transaction) => operation(transaction),
    USER_ROLE_UPDATE_TRANSACTION_OPTIONS
  ),
  recordAuditLog: safelyRecordAuditLog
};

export async function updateUserRole(userId: string, role: AppRole, performedById: string) {
  return updateUserRoleWithDependencies(userId, role, performedById, userRoleUpdateDependencies);
}
