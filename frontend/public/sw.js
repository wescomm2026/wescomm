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
    icon: "/assets/wescomm-logo.png",
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

  const targetUrl = new URL(event.notification.data?.url || "/student/dashboard", self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      const existingClient = clientList.find((client) => client.url.startsWith(self.location.origin));

      if (existingClient) {
        if ("navigate" in existingClient) {
          existingClient.navigate(targetUrl);
        }
        return existingClient.focus();
      }

      return self.clients.openWindow(targetUrl);
    })
  );
});
