const BUILD_ID = "e49788ccaaf3508d";
const CACHE_PREFIX = "wescomm-pwa";
const SHELL_CACHE = `${CACHE_PREFIX}-shell-${BUILD_ID}`;
const STATIC_CACHE = `${CACHE_PREFIX}-static-${BUILD_ID}`;
const PUBLIC_ASSET_CACHE = `${CACHE_PREFIX}-assets-${BUILD_ID}`;
const ACTIVE_CACHES = new Set([SHELL_CACHE, STATIC_CACHE, PUBLIC_ASSET_CACHE]);
const RUNTIME_CACHE_ENABLED = new URL(self.location.href).searchParams.get("runtime-cache") !== "off";
const OFFLINE_FALLBACK = "/offline.html";
const PRECACHE_URLS = [
  OFFLINE_FALLBACK,
  "/manifest.webmanifest",
  "/icons/wescomm-icon-192.png",
  "/icons/wescomm-icon-512.png",
  "/icons/wescomm-maskable-512.png",
  "/icons/apple-touch-icon.png"
];
const MAX_PUBLIC_ASSETS = 80;
const MAX_STATIC_ASSETS = 120;

self.addEventListener("install", (event) => {
  if (!RUNTIME_CACHE_ENABLED) return;
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(PRECACHE_URLS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && !ACTIVE_CACHES.has(key))
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok && response.type === "basic") {
    try {
      const cache = await caches.open(STATIC_CACHE);
      await cache.put(request, response.clone());
      await trimCache(cache, MAX_STATIC_ASSETS);
    } catch {
      // Cache writes are best-effort and must never break an online request.
    }
  }
  return response;
}

async function trimCache(cache, maximumEntries) {
  const keys = await cache.keys();
  if (keys.length <= maximumEntries) return;
  await Promise.all(keys.slice(0, keys.length - maximumEntries).map((key) => cache.delete(key)));
}

async function updatePublicAsset(request) {
  const response = await fetch(request);
  if (!response.ok || response.type !== "basic") return response;

  try {
    const cache = await caches.open(PUBLIC_ASSET_CACHE);
    await cache.put(request, response.clone());
    await trimCache(cache, MAX_PUBLIC_ASSETS);
  } catch {
    // Mobile browsers can evict Cache Storage under pressure.
  }
  return response;
}

async function staleWhileRevalidate(request, event) {
  const cached = await caches.match(request);
  const update = updatePublicAsset(request).catch(() => undefined);

  if (cached) {
    event.waitUntil(update);
    return cached;
  }

  const response = await update;
  return response ?? Response.error();
}

async function networkFirstNavigation(request) {
  try {
    return await fetch(request, { cache: "no-store" });
  } catch {
    return (await caches.match(OFFLINE_FALLBACK)) ?? Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  if (!RUNTIME_CACHE_ENABLED) return;

  const { request } = event;
  if (request.method !== "GET" || request.headers.has("range")) return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Authentication, API, and transactional data always go directly to the
  // network and are never written to the service-worker cache.
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  const isPublicAsset =
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/assets/wescomm-logo.png" ||
    (url.pathname.startsWith("/assets/") && url.pathname.endsWith(".svg"));

  if (isPublicAsset) {
    event.respondWith(staleWhileRevalidate(request, event));
  }
});

self.addEventListener("push", (event) => {
  let payload = {
    title: "WESCOMM",
    body: "You have a new WESCOMM update.",
    type: "SYSTEM",
    url: "/student/dashboard"
  };

  try {
    if (event.data) {
      payload = { ...payload, ...event.data.json() };
    }
  } catch {
    payload.body = event.data?.text() || payload.body;
  }

  const options = {
    body: payload.body,
    icon: "/icons/wescomm-icon-192.png",
    badge: "/assets/notifications.svg",
    tag: payload.notificationId ? `wescomm-${payload.notificationId}` : `wescomm-${payload.type}-${Date.now()}`,
    renotify: true,
    timestamp: Date.now(),
    data: {
      url: payload.url || "/student/dashboard",
      notificationId: payload.notificationId || null
    }
  };

  event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  let targetUrl = new URL("/student/dashboard", self.location.origin).href;
  try {
    const requestedUrl = new URL(event.notification.data?.url || "/student/dashboard", self.location.origin);
    if (requestedUrl.origin === self.location.origin) targetUrl = requestedUrl.href;
  } catch {
    // Invalid or external notification URLs fall back to the dashboard.
  }

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clientList) => {
      const existingClient = clientList.find((client) => client.url.startsWith(self.location.origin));

      if (existingClient) {
        if ("navigate" in existingClient) {
          await existingClient.navigate(targetUrl);
        }
        return existingClient.focus();
      }

      return self.clients.openWindow(targetUrl);
    })
  );
});
