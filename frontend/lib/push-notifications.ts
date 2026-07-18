import {
  getPushPublicConfigFromApi,
  removePushSubscriptionFromApi,
  savePushSubscriptionToApi,
  sendPushTestFromApi
} from "@/lib/api";
import { registerWescommServiceWorker } from "@/lib/service-worker";

export type PushCapabilityState =
  | "unsupported"
  | "not-configured"
  | "default"
  | "granted"
  | "denied";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = `${base64String}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let index = 0; index < rawData.length; index += 1) {
    outputArray[index] = rawData.charCodeAt(index);
  }

  return outputArray;
}

export function isWebPushSupported() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export async function getWebPushState(): Promise<PushCapabilityState> {
  if (!isWebPushSupported()) return "unsupported";

  const config = await getPushPublicConfigFromApi();
  if (!config.enabled || !config.publicKey) return "not-configured";

  if (Notification.permission !== "granted") return Notification.permission as PushCapabilityState;

  const registration = await navigator.serviceWorker.getRegistration("/");
  await registration?.update().catch(() => undefined);
  const subscription = await registration?.pushManager.getSubscription();
  return subscription ? "granted" : "default";
}

async function getServiceWorkerRegistration() {
  const registration = await registerWescommServiceWorker();
  await registration.update().catch(() => undefined);
  await navigator.serviceWorker.ready;
  return registration;
}

export async function enableWebPushNotifications(token: string) {
  if (!isWebPushSupported()) {
    throw new Error("This browser does not support web push notifications.");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(permission === "denied"
      ? "Notifications are blocked. Enable them in your browser or phone site settings."
      : "Notification permission was not granted.");
  }

  const config = await getPushPublicConfigFromApi();
  if (!config.enabled || !config.publicKey) {
    throw new Error("Web push is not configured yet. Add VAPID keys on the backend first.");
  }

  const registration = await getServiceWorkerRegistration();
  const existingSubscription = await registration.pushManager.getSubscription();
  const subscription = existingSubscription ?? await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(config.publicKey)
  });

  await savePushSubscriptionToApi(token, subscription.toJSON());
  await sendPushTestFromApi(token);
  return subscription;
}

export async function disableWebPushNotifications(token: string) {
  if (!isWebPushSupported()) return;

  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;

  await Promise.all([
    removePushSubscriptionFromApi(token, subscription.endpoint).catch(() => undefined),
    subscription.unsubscribe()
  ]);
}

export async function sendWebPushTest(token: string) {
  return sendPushTestFromApi(token);
}
