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
