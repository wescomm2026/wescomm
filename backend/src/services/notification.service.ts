import { supabaseAdmin } from "../lib/supabase.js";
import type { AppRole, NotificationType } from "../types/app.js";
import { sendPushToUser } from "./push.service.js";
import { HttpError } from "../utils/http-error.js";
import { publishRealtimeEventsBestEffort, REALTIME_TOPICS } from "./realtime-event.service.js";

type RawNotification = {
  id: string;
  user_id: string;
  title: string;
  message: string;
  type: string;
  action_url: string | null;
  read_at: string | null;
  created_at: string;
};

export type NotificationInput = {
  userId: string;
  title: string;
  message: string;
  type?: NotificationType;
  actionUrl?: string | null;
  dedupeKey?: string | null;
};

function mapNotification(row: RawNotification) {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    message: row.message,
    type: row.type,
    actionUrl: row.action_url,
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
          type: notification.type as NotificationType,
          url: notification.actionUrl ?? undefined
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
      type: input.type ?? "SYSTEM",
      action_url: input.actionUrl ?? null,
      dedupe_key: input.dedupeKey ?? null
    })
    .select("*")
    .single();

  if (error) throw HttpError.fromSupabase(error);
  const notification = mapNotification(data as RawNotification);
  await publishRealtimeEventsBestEffort([{
    topic: REALTIME_TOPICS.notifications,
    dedupeKey: `notification:${notification.id}:realtime`,
    entityId: notification.id,
    audienceUserIds: [notification.userId],
    payload: { action: "created", notificationId: notification.id }
  }]);
  dispatchPushNotifications([notification]);
  return notification;
}

export async function createNotificationBestEffort(input: NotificationInput) {
  try {
    return await createNotification(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown notification error.";
    console.warn(`Unable to create notification: ${message}`);
    return null;
  }
}

export async function createNotificationsForRolesBestEffort(
  roles: AppRole[],
  input: Omit<NotificationInput, "userId">
) {
  try {
    return await createNotificationsForRoles(roles, input);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown role notification error.";
    console.warn(`Unable to create role notifications: ${message}`);
    return [];
  }
}

export async function createNotificationsForRoles(
  roles: AppRole[],
  input: Omit<NotificationInput, "userId">
) {
  const { data: profileRows, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("id,role")
    .in("role", roles);

  if (profileError) throw HttpError.fromSupabase(profileError);

  const rows = (profileRows ?? []).map((profile) => ({
    user_id: profile.id,
    title: input.title,
    message: input.message,
    type: input.type ?? "SYSTEM",
    action_url: input.actionUrl ?? null,
    dedupe_key: input.dedupeKey ? `${input.dedupeKey}:${profile.id}` : null
  }));

  if (!rows.length) return [];

  const { data, error } = await supabaseAdmin.from("notifications").insert(rows).select("*");
  if (error) throw HttpError.fromSupabase(error);

  const roleByUserId = new Map(
    (profileRows ?? []).map((profile) => [profile.id as string, profile.role as AppRole])
  );
  const notifications = ((data ?? []) as RawNotification[]).map(mapNotification);
  await publishRealtimeEventsBestEffort(notifications.map((notification) => ({
    topic: REALTIME_TOPICS.notifications,
    dedupeKey: `notification:${notification.id}:realtime`,
    entityId: notification.id,
    audienceUserIds: [notification.userId],
    payload: { action: "created", notificationId: notification.id }
  })));
  dispatchPushNotifications(notifications, roleByUserId);
  return notifications;
}

const notificationColumns = "id,user_id,title,message,type,action_url,read_at,created_at";

export async function listNotifications(
  userId: string,
  options: { limit?: number; before?: string } = {}
) {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
  let query = supabaseAdmin
    .from("notifications")
    .select(notificationColumns)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit + 1);

  if (options.before) query = query.lt("created_at", options.before);

  const { data, error } = await query;

  if (error) throw HttpError.fromSupabase(error);
  const rows = (data ?? []) as RawNotification[];
  const hasMore = rows.length > limit;
  const notifications = rows.slice(0, limit).map(mapNotification);
  return {
    notifications,
    nextCursor: hasMore ? notifications.at(-1)?.createdAt ?? null : null
  };
}

export async function getUnreadNotificationCount(userId: string) {
  const { count, error } = await supabaseAdmin
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null);

  if (error) throw HttpError.fromSupabase(error);
  return count ?? 0;
}

export async function markNotificationRead(notificationId: string, userId: string) {
  const { data, error } = await supabaseAdmin
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("user_id", userId)
    .select("*")
    .maybeSingle();

  if (error) throw HttpError.fromSupabase(error);
  return data ? mapNotification(data as RawNotification) : null;
}

export async function markAllNotificationsRead(userId: string) {
  const readAt = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("notifications")
    .update({ read_at: readAt })
    .eq("user_id", userId)
    .is("read_at", null)
    .select("id");

  if (error) throw HttpError.fromSupabase(error);
  return (data ?? []).length;
}
