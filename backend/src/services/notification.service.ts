import { supabaseAdmin } from "../lib/supabase.js";
import type { AppRole, NotificationType } from "../types/app.js";
import { sendPushToUser } from "./push.service.js";
import { HttpError } from "../utils/http-error.js";

type RawNotification = {
  id: string;
  user_id: string;
  title: string;
  message: string;
  type: string;
  read_at: string | null;
  created_at: string;
};

type NotificationInput = {
  userId: string;
  title: string;
  message: string;
  type?: NotificationType;
};

function mapNotification(row: RawNotification) {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    message: row.message,
    type: row.type,
    readAt: row.read_at,
    createdAt: row.created_at
  };
}

function dispatchPushNotifications(
  notifications: ReturnType<typeof mapNotification>[],
  roleByUserId = new Map<string, AppRole>()
) {
  void Promise.all(
    notifications.map((notification) =>
      sendPushToUser(
        notification.userId,
        {
          id: notification.id,
          title: notification.title,
          message: notification.message,
          type: notification.type as NotificationType
        },
        roleByUserId.get(notification.userId)
      )
    )
  ).catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown push dispatch error.";
    console.warn(`Unable to dispatch web push notifications: ${message}`);
  });
}

export async function createNotification(input: NotificationInput) {
  const { data, error } = await supabaseAdmin
    .from("notifications")
    .insert({
      user_id: input.userId,
      title: input.title,
      message: input.message,
      type: input.type ?? "SYSTEM"
    })
    .select("*")
    .single();

  if (error) throw new HttpError(500, error.message);
  const notification = mapNotification(data as RawNotification);
  dispatchPushNotifications([notification]);
  return notification;
}

export async function createNotificationsForRoles(
  roles: AppRole[],
  input: Omit<NotificationInput, "userId">
) {
  const { data: profileRows, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("id,role")
    .in("role", roles);

  if (profileError) throw new HttpError(500, profileError.message);

  const rows = (profileRows ?? []).map((profile) => ({
    user_id: profile.id,
    title: input.title,
    message: input.message,
    type: input.type ?? "SYSTEM"
  }));

  if (!rows.length) return [];

  const { data, error } = await supabaseAdmin.from("notifications").insert(rows).select("*");
  if (error) throw new HttpError(500, error.message);

  const roleByUserId = new Map(
    (profileRows ?? []).map((profile) => [profile.id as string, profile.role as AppRole])
  );
  const notifications = ((data ?? []) as RawNotification[]).map(mapNotification);
  dispatchPushNotifications(notifications, roleByUserId);
  return notifications;
}

export async function listNotifications(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw new HttpError(500, error.message);
  return ((data ?? []) as RawNotification[]).map(mapNotification);
}

export async function markNotificationRead(notificationId: string, userId: string) {
  const { data, error } = await supabaseAdmin
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("user_id", userId)
    .select("*")
    .maybeSingle();

  if (error) throw new HttpError(500, error.message);
  return data ? mapNotification(data as RawNotification) : null;
}

export async function markAllNotificationsRead(userId: string) {
  const readAt = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("notifications")
    .update({ read_at: readAt })
    .eq("user_id", userId)
    .is("read_at", null)
    .select("*");

  if (error) throw new HttpError(500, error.message);
  return ((data ?? []) as RawNotification[]).map(mapNotification);
}
