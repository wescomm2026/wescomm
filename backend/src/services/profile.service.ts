import { supabaseAdmin } from "../lib/supabase.js";
import type { ProfileUpdateInput } from "../domain/profile-update.js";
import { type Profile, type RawProfile, mapProfile } from "../types/app.js";
import { encryptSensitiveText } from "../utils/field-encryption.js";
import { HttpError } from "../utils/http-error.js";
import { safelyRecordAuditLog } from "./audit-log.service.js";

const profileFieldMap = {
  fullName: "full_name",
  phone: "phone",
  department: "department",
  address: "address"
} as const;

type MutableProfileField = keyof typeof profileFieldMap;

function changedFields(current: Profile, input: ProfileUpdateInput) {
  return (Object.keys(profileFieldMap) as MutableProfileField[]).filter((field) => (
    input[field] !== undefined && input[field] !== current[field]
  ));
}

export async function updateOwnProfile(
  currentProfile: Profile,
  input: ProfileUpdateInput
) {
  const fields = changedFields(currentProfile, input);
  if (fields.length === 0) return currentProfile;

  const update: Record<string, string | null> = {
    updated_at: new Date().toISOString()
  };

  for (const field of fields) {
    const databaseField = profileFieldMap[field];
    const value = input[field];
    update[databaseField] = field === "phone" || field === "address"
      ? encryptSensitiveText(value, `profile.${field}`)
      : value ?? null;
  }

  const { data, error } = await supabaseAdmin
    .from("profiles")
    .update(update)
    .eq("id", currentProfile.id)
    .select("*")
    .single();

  if (error) throw HttpError.fromSupabase(error);

  const profile = mapProfile(data as RawProfile);
  if (!profile) throw new HttpError(500, "Updated profile could not be loaded.");

  await safelyRecordAuditLog({
    actorId: currentProfile.id,
    action: "PROFILE_UPDATED",
    entityType: "profile",
    entityId: currentProfile.id,
    summary: "Updated own profile information.",
    metadata: { fields }
  });

  return profile;
}
