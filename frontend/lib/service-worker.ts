export function developmentPwaCleanupScript() {
  return String.raw`(() => {
    if (!("serviceWorker" in navigator)) return;

    const cachePrefix = "wescomm-pwa";
    const reloadKey = "wescomm:dev-service-worker-cleanup:v1";
    const controller = navigator.serviceWorker.controller;
    let controlledByWescomm = false;
    let cleanupReloadStarted = false;

    try {
      controlledByWescomm = Boolean(controller) && new URL(controller.scriptURL).pathname === "/sw.js";
    } catch {
      controlledByWescomm = false;
    }

    try {
      cleanupReloadStarted = sessionStorage.getItem(reloadKey) === "1";
    } catch {}

    if (controlledByWescomm && !cleanupReloadStarted) {
      try { sessionStorage.setItem(reloadKey, "1"); } catch {}
      window.stop();
    }

    const removeRegistrations = navigator.serviceWorker.getRegistrations()
      .then((registrations) => Promise.all(registrations.map((registration) => {
        try {
          return new URL(registration.active?.scriptURL || registration.waiting?.scriptURL || registration.installing?.scriptURL || "", location.href).pathname === "/sw.js"
            ? registration.unregister()
            : false;
        } catch {
          return false;
        }
      })));
    const removeCaches = "caches" in window
      ? caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith(cachePrefix)).map((key) => caches.delete(key))))
      : Promise.resolve([]);

    Promise.all([removeRegistrations, removeCaches]).then(() => {
      if (!controlledByWescomm) {
        try { sessionStorage.removeItem(reloadKey); } catch {}
        return;
      }

      if (!cleanupReloadStarted) location.reload();
      else {
        try { sessionStorage.removeItem(reloadKey); } catch {}
      }
    }).catch(() => {
      if (controlledByWescomm && !cleanupReloadStarted) location.reload();
    });
  })();`;
}

export function wescommServiceWorkerUrl(enableRuntimeCaching = process.env.NODE_ENV === "production") {
  return enableRuntimeCaching ? "/sw.js" : "/sw.js?runtime-cache=off";
}

export function registerWescommServiceWorker(
  enableRuntimeCaching = process.env.NODE_ENV === "production"
) {
  return navigator.serviceWorker.register(wescommServiceWorkerUrl(enableRuntimeCaching), {
    scope: "/",
    updateViaCache: "none"
  });
}
