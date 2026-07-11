import type { AppRole as PrismaAppRole } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { safelyRecordAuditLog } from "./audit-log.service.js";
import type { AppRole } from "../types/app.js";
import { HttpError } from "../utils/http-error.js";
import { decryptSensitiveText } from "../utils/field-encryption.js";

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
  const users = await prisma.profile.findMany({
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
  });

  return users.map(mapUser);
}

export async function listStaffVisibleUsers() {
  const users = await prisma.profile.findMany({
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
  });

  return users.map(mapUser);
}

export async function updateUserRole(userId: string, role: AppRole, performedById: string) {
  const existingUser = await prisma.profile.findUnique({
    where: { id: userId },
    select: { id: true, role: true }
  });

  if (!existingUser) throw new HttpError(404, "User not found.");
  if (userId === performedById && role !== "ADMIN") {
    throw new HttpError(400, "You cannot remove your own admin access.");
  }

  if (existingUser.role === "ADMIN" && role !== "ADMIN") {
    const adminCount = await prisma.profile.count({ where: { role: "ADMIN" } });
    if (adminCount <= 1) throw new HttpError(400, "At least one admin account is required.");
  }

  const user = await prisma.profile.update({
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

  const mappedUser = mapUser(user);

  await safelyRecordAuditLog({
    actorId: performedById,
    action: "USER_ROLE_UPDATED",
    entityType: "user",
    entityId: userId,
    summary: `Updated ${mappedUser.email} role from ${existingUser.role} to ${mappedUser.role}.`,
    metadata: {
      email: mappedUser.email,
      previousRole: existingUser.role,
      nextRole: mappedUser.role
    }
  });

  return mappedUser;
}
