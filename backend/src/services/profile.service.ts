import { supabaseAdmin } from "../lib/supabase.js";
import type { OnboardingInput, ProfileUpdateInput } from "../domain/profile-update.js";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { type Profile, type RawProfile, mapProfile } from "../types/app.js";
import { encryptSensitiveText } from "../utils/field-encryption.js";
import { HttpError } from "../utils/http-error.js";
import { safelyRecordAuditLog } from "./audit-log.service.js";

const profileFieldMap = {
  fullName: "full_name",
  studentNumber: "student_number",
  phone: "phone",
  address: "address"
} as const;

type MutableProfileField = keyof typeof profileFieldMap;

function changedFields(current: Profile, input: ProfileUpdateInput) {
  const fields: Array<MutableProfileField | "departmentId"> = (Object.keys(profileFieldMap) as MutableProfileField[]).filter((field) => (
    input[field] !== undefined && input[field] !== current[field]
  ));
  if (input.departmentId !== undefined && input.departmentId !== current.departmentId) fields.push("departmentId");
  return fields;
}

export async function updateOwnProfile(
  currentProfile: Profile,
  input: ProfileUpdateInput
) {
  const fields = changedFields(currentProfile, input);
  if (fields.length === 0) return currentProfile;

  const updatesStudentIdentity = input.departmentId !== undefined || input.studentNumber !== undefined;
  if (updatesStudentIdentity && currentProfile.role !== "STUDENT") {
    throw new HttpError(403, "Only student accounts can update Department and Student ID.");
  }

  const department = input.departmentId !== undefined && input.departmentId !== currentProfile.departmentId
    ? await prisma.department.findFirst({
        where: { id: input.departmentId, isActive: true },
        select: { id: true, displayName: true }
      })
    : null;
  if (input.departmentId !== undefined && input.departmentId !== currentProfile.departmentId && !department) {
    throw new HttpError(400, "Choose an active department.", "DEPARTMENT_INACTIVE");
  }

  const update: Record<string, string | null> = {
    updated_at: new Date().toISOString()
  };

  for (const field of fields.filter((field): field is MutableProfileField => field !== "departmentId")) {
    const databaseField = profileFieldMap[field];
    const value = input[field];
    update[databaseField] = field === "phone" || field === "address"
      ? encryptSensitiveText(value, `profile.${field}`)
      : value ?? null;
  }

  if (department) {
    update.department_id = department.id;
    update.department = department.displayName;
  }

  const { data, error } = await supabaseAdmin
    .from("profiles")
    .update(update)
    .eq("id", currentProfile.id)
    .select("*")
    .single();

  if (error?.code === "23505" && fields.includes("studentNumber")) {
    throw new HttpError(409, "That Student ID number is already registered.", "STUDENT_NUMBER_TAKEN");
  }
  if (error) throw HttpError.fromSupabase(error);

  const profile = mapProfile(data as RawProfile);
  if (!profile) throw new HttpError(500, "Updated profile could not be loaded.");

  await safelyRecordAuditLog({
    actorId: currentProfile.id,
    action: "PROFILE_UPDATED",
    entityType: "profile",
    entityId: currentProfile.id,
    summary: "Updated own profile information.",
    metadata: {
      fields,
      ...(fields.includes("departmentId") ? { departmentId: department?.id } : {})
    }
  });

  return profile;
}

export async function listActiveDepartments() {
  return prisma.department.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    select: { id: true, code: true, groupName: true, displayName: true }
  });
}

export async function completeStudentOnboarding(currentProfile: Profile, input: OnboardingInput) {
  if (currentProfile.role !== "STUDENT") {
    throw new HttpError(403, "Only student accounts use student onboarding.");
  }
  if (currentProfile.onboardingCompletedAt) {
    throw new HttpError(409, "Student onboarding is already complete.", "ONBOARDING_ALREADY_COMPLETED");
  }
  const department = await prisma.department.findFirst({
    where: { id: input.departmentId, isActive: true },
    select: { id: true, displayName: true }
  });
  if (!department) throw new HttpError(400, "Choose an active department.", "DEPARTMENT_INACTIVE");

  const now = new Date();
  try {
    const updated = await prisma.profile.update({
      where: { id: currentProfile.id },
      data: {
        departmentId: department.id,
        department: department.displayName,
        studentNumber: input.studentNumber,
        phone: encryptSensitiveText(input.phone, "profile.phone"),
        address: encryptSensitiveText(input.address, "profile.address"),
        onboardingCompletedAt: now,
        updatedAt: now
      },
      select: { id: true, fullName: true, email: true, studentNumber: true, departmentId: true, role: true, avatarUrl: true, createdAt: true, updatedAt: true }
    });
    await safelyRecordAuditLog({
      actorId: currentProfile.id,
      action: "STUDENT_ONBOARDING_COMPLETED",
      entityType: "profile",
      entityId: currentProfile.id,
      summary: "Completed required student onboarding.",
      metadata: { departmentId: department.id }
    });
    return {
      ...updated,
      phone: input.phone ?? null,
      department: department.displayName,
      address: input.address ?? null,
      onboardingCompletedAt: now.toISOString(),
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString()
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new HttpError(409, "That Student ID number is already registered.", "STUDENT_NUMBER_TAKEN");
    }
    throw error;
  }
}
