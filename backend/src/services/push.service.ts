import webPush, { type PushSubscription } from "web-push";
import { env } from "../config/env.js";
import { supabaseAdmin } from "../lib/supabase.js";
import type { AppRole, NotificationType } from "../types/app.js";
import {
  decryptSensitiveText,
  encryptSensitiveText,
  hashHighEntropyLookup
} from "../utils/field-encryption.js";
import { HttpError } from "../utils/http-error.js";

type RawPushSubscription = {
  id: string;
  user_id: string;
  endpoint: string;
  endpoint_hash: string | null;
  p256dh: string;
  auth: string;
  user_agent: string | null;
  created_at: string;
  updated_at: string;
  revoked_at: string | null;
};

export type WebPushSubscriptionInput = {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
};

type PushNotificationPayload = {
  id?: string;
  title: string;
  message: string;
  type?: NotificationType;
  url?: string;
};

const pushConfigured = Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);

if (pushConfigured) {
  webPush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);
}

export function getPushPublicConfig() {
  return {
    enabled: pushConfigured,
    publicKey: env.VAPID_PUBLIC_KEY ?? ""
  };
}

function mapRawSubscription(row: RawPushSubscription): PushSubscription {
  return {
    endpoint: decryptSensitiveText(row.endpoint, "push.endpoint") ?? "",
    keys: {
      p256dh: decryptSensitiveText(row.p256dh, "push.p256dh") ?? "",
      auth: decryptSensitiveText(row.auth, "push.auth") ?? ""
    }
  };
}

function validateSubscription(subscription: WebPushSubscriptionInput) {
  if (!subscription.endpoint?.trim()) throw new HttpError(400, "Push subscription endpoint is required.");
  if (!subscription.keys?.p256dh?.trim()) throw new HttpError(400, "Push subscription p256dh key is required.");
  if (!subscription.keys?.auth?.trim()) throw new HttpError(400, "Push subscription auth key is required.");
}

export function notificationUrlForRole(type: NotificationType | undefined, role?: AppRole) {
  const isStaffSide = role === "STAFF" || role === "ADMIN";
  const base = role === "ADMIN" ? "/admin" : isStaffSide ? "/staff" : "/student";

  if (type === "RESERVATION") return `${base}/reservations`;
  if (type === "RECEIPT") return isStaffSide ? `${base}/receipt-verification` : `${base}/receipts`;
  if (type === "LOW_STOCK") return isStaffSide ? `${base}/inventory` : `${base}/shop`;
  if (type === "BACK_IN_STOCK") return isStaffSide ? `${base}/inventory` : `${base}/shop?wishlist=1`;
  if (type === "MESSAGE") return isStaffSide ? `${base}/messages` : `${base}/support`;
  return `${base}/dashboard`;
}

function lockScreenSafeContent(payload: PushNotificationPayload) {
  if (payload.type === "RESERVATION") {
    return { title: "Reservation update", body: "Open WESCOMM to view your latest reservation status." };
  }
  if (payload.type === "RECEIPT") {
    return { title: "Receipt update", body: "Open WESCOMM to view your latest digital receipt update." };
  }
  if (payload.type === "MESSAGE") {
    return { title: "Support update", body: "You have a new WESCOMM support update." };
  }
  return { title: payload.title, body: payload.message };
}

async function loadRoleByUserId(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw HttpError.fromSupabase(error);
  return (data?.role as AppRole | undefined) ?? "STUDENT";
}

async function markSubscriptionRevoked(subscriptionId: string) {
  await supabaseAdmin
    .from("push_subscriptions")
    .update({
      revoked_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq("id", subscriptionId);
}

function getPushErrorStatusCode(error: unknown) {
  return typeof error === "object" && error && "statusCode" in error
    ? Number((error as { statusCode?: unknown }).statusCode)
    : 0;
}

function getPushErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown push delivery error.";
}

function shouldRevokeSubscription(statusCode: number) {
  return [400, 401, 403, 404, 410].includes(statusCode);
}

export async function savePushSubscription(input: {
  userId: string;
  subscription: WebPushSubscriptionInput;
  userAgent?: string;
}) {
  validateSubscription(input.subscription);

  const endpointHash = hashHighEntropyLookup(input.subscription.endpoint, "push.endpoint");
  const { data: existingByHash, error: hashLookupError } = await supabaseAdmin
    .from("push_subscriptions")
    .select("id")
    .eq("endpoint_hash", endpointHash)
    .maybeSingle();
  if (hashLookupError) throw HttpError.fromSupabase(hashLookupError);

  let existing = existingByHash as { id: string } | null;
  if (!existing) {
    const { data: legacyRow, error: legacyLookupError } = await supabaseAdmin
      .from("push_subscriptions")
      .select("id")
      .eq("endpoint", input.subscription.endpoint)
      .maybeSingle();
    if (legacyLookupError) throw HttpError.fromSupabase(legacyLookupError);
    existing = legacyRow as { id: string } | null;
  }

  const encryptedValues = {
    user_id: input.userId,
    endpoint: encryptSensitiveText(input.subscription.endpoint, "push.endpoint"),
    endpoint_hash: endpointHash,
    p256dh: encryptSensitiveText(input.subscription.keys.p256dh, "push.p256dh"),
    auth: encryptSensitiveText(input.subscription.keys.auth, "push.auth"),
    user_agent: input.userAgent?.slice(0, 500) ?? null,
    revoked_at: null,
    updated_at: new Date().toISOString()
  };

  const query = existing
    ? supabaseAdmin.from("push_subscriptions").update(encryptedValues).eq("id", existing.id)
    : supabaseAdmin.from("push_subscriptions").insert(encryptedValues);
  const { data, error } = await query.select("*").single();

  if (error) throw HttpError.fromSupabase(error);
  return data as RawPushSubscription;
}

export async function removePushSubscription(input: {
  userId: string;
  endpoint: string;
}) {
  const endpointHash = hashHighEntropyLookup(input.endpoint, "push.endpoint");
  const { error } = await supabaseAdmin
    .from("push_subscriptions")
    .update({
      revoked_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq("user_id", input.userId)
    .eq("endpoint_hash", endpointHash);

  if (error) throw HttpError.fromSupabase(error);

  await supabaseAdmin
    .from("push_subscriptions")
    .update({ revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("user_id", input.userId)
    .eq("endpoint", input.endpoint);
}

export async function sendPushToUser(userId: string, payload: PushNotificationPayload, role?: AppRole) {
  if (!pushConfigured) return { sent: 0, skipped: true };

  const { data, error } = await supabaseAdmin
    .from("push_subscriptions")
    .select("*")
    .eq("user_id", userId)
    .is("revoked_at", null);

  if (error) {
    console.error("Unable to load push subscriptions:", error.message);
    return { sent: 0, skipped: true };
  }

  const subscriptions = (data ?? []) as RawPushSubscription[];
  if (!subscriptions.length) return { sent: 0, skipped: false };

  const resolvedRole = role ?? (await loadRoleByUserId(userId));
  const safeContent = lockScreenSafeContent(payload);
  const body = JSON.stringify({
    notificationId: payload.id,
    title: safeContent.title,
    body: safeContent.body,
    type: payload.type ?? "SYSTEM",
    url: payload.url ?? notificationUrlForRole(payload.type, resolvedRole)
  });

  const results = await Promise.allSettled(
    subscriptions.map(async (subscription) => {
      try {
        await webPush.sendNotification(mapRawSubscription(subscription), body);
        return true;
      } catch (error) {
        const statusCode = getPushErrorStatusCode(error);

        if (shouldRevokeSubscription(statusCode)) {
          await markSubscriptionRevoked(subscription.id);
          console.warn(`Revoked stale web push subscription after delivery failed${statusCode ? ` (${statusCode})` : ""}.`);
          return false;
        }

        console.warn(`Unable to send push notification${statusCode ? ` (${statusCode})` : ""}: ${getPushErrorMessage(error)}`);
        return false;
      }
    })
  );

  return {
    sent: results.filter((result) => result.status === "fulfilled" && result.value).length,
    skipped: false
  };
}
