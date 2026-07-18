import { expect, test } from "@playwright/test";
import sharp from "sharp";

test("exposes an installable manifest with real square icons", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Manifest coverage only needs one Chromium project.");

  await page.goto("/student/dashboard");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");

  const response = await request.get("/manifest.webmanifest");
  expect(response.ok()).toBe(true);
  const manifest = await response.json() as {
    id: string;
    start_url: string;
    scope: string;
    display: string;
    theme_color: string;
    background_color: string;
    icons: Array<{ src: string; sizes: string; purpose: string }>;
  };

  expect(manifest).toMatchObject({
    id: "/",
    start_url: "/student/dashboard",
    scope: "/",
    display: "standalone",
    theme_color: "#006633",
    background_color: "#f6faf7"
  });
  expect(manifest.icons.some((icon) => icon.purpose === "maskable")).toBe(true);

  for (const icon of manifest.icons) {
    const iconResponse = await request.get(icon.src);
    expect(iconResponse.ok(), `${icon.src} should be available`).toBe(true);
    const metadata = await sharp(await iconResponse.body()).metadata();
    const declaredSize = Number(icon.sizes.split("x")[0]);
    expect(metadata.width, `${icon.src} width`).toBe(declaredSize);
    expect(metadata.height, `${icon.src} height`).toBe(declaredSize);
  }
});

test("registers one root service worker and never serves API data offline", async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Service-worker policy coverage only needs one Chromium project.");

  await page.goto("/student/dashboard");
  const registration = await page.evaluate(async () => {
    const readyRegistration = await navigator.serviceWorker.ready;
    return {
      scope: readyRegistration.scope,
      scriptUrl: readyRegistration.active?.scriptURL ?? ""
    };
  });

  expect(new URL(registration.scope).pathname).toBe("/");
  expect(new URL(registration.scriptUrl).pathname).toBe("/sw.js");

  const probePath = `/api/backend/health?pwa-probe=${Date.now()}`;
  const onlineResult = await page.evaluate(async (path) => {
    const response = await fetch(path, { cache: "no-store" });
    return {
      status: response.status,
      cacheControl: response.headers.get("cache-control")
    };
  }, probePath);
  expect(onlineResult.status).toBe(200);
  expect(onlineResult.cacheControl).toContain("no-store");

  const cachedApiRequests = await page.evaluate(async () => {
    const matches: string[] = [];
    for (const cacheName of await caches.keys()) {
      const cache = await caches.open(cacheName);
      for (const request of await cache.keys()) {
        if (new URL(request.url).pathname.startsWith("/api/")) matches.push(request.url);
      }
    }
    return matches;
  });
  expect(cachedApiRequests).toEqual([]);

  await context.setOffline(true);
  try {
    const offlineResult = await page.evaluate(async (path) => {
      try {
        await fetch(path, { cache: "no-store" });
        return "resolved";
      } catch {
        return "rejected";
      }
    }, `${probePath}-offline`);
    expect(offlineResult).toBe("rejected");
  } finally {
    await context.setOffline(false);
  }
});

test("serves the safe fallback page for an offline navigation in production", async ({ page, context }, testInfo) => {
  test.skip(
    process.env.E2E_USE_PRODUCTION !== "true" || testInfo.project.name !== "desktop-chromium",
    "Runtime navigation caching is intentionally disabled outside a production build."
  );

  await page.goto("/student/dashboard");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));

  await context.setOffline(true);
  try {
    await page.goto(`/student/shop?offline-check=${Date.now()}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Internet connection required" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});

test("shows a connection banner while offline and clears it after reconnecting", async ({ page, context }) => {
  await page.goto("/student/dashboard");

  await context.setOffline(true);
  try {
    await expect(page.getByTestId("pwa-offline-banner")).toBeVisible();
    await expect(page.getByText("WESCOMM data and transactions need an internet connection.")).toBeVisible();
  } finally {
    await context.setOffline(false);
  }

  await expect(page.getByTestId("pwa-offline-banner")).toBeHidden();
});

test("offers the browser install action when install criteria are met", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Install prompt behavior only needs one Chromium project.");

  await page.goto("/student/dashboard");
  const prompt = page.getByTestId("pwa-install-prompt");
  await expect.poll(async () => {
    await page.evaluate(() => {
      const promptEvent = new Event("beforeinstallprompt");
      Object.defineProperties(promptEvent, {
        platforms: { value: ["web"] },
        prompt: {
          value: async () => window.sessionStorage.setItem("pwa-install-prompt-called", "true")
        },
        userChoice: {
          value: Promise.resolve({ outcome: "accepted", platform: "web" })
        }
      });
      window.dispatchEvent(promptEvent);
    });
    return prompt.isVisible().catch(() => false);
  }).toBe(true);
  await prompt.getByRole("button", { name: "Install", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem("pwa-install-prompt-called")))
    .toBe("true");
  await expect(prompt).toBeHidden();
});

test("activates a waiting service worker only after the user accepts the update", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Update lifecycle behavior only needs one Chromium project.");

  await page.addInitScript(() => {
    const serviceWorkerContainer = new EventTarget();
    const waitingWorker = {
      state: "installed",
      postMessage(message: unknown) {
        window.sessionStorage.setItem("pwa-update-message", JSON.stringify(message));
        window.setTimeout(() => serviceWorkerContainer.dispatchEvent(new Event("controllerchange")), 0);
      }
    };
    const registration = new EventTarget() as EventTarget & {
      scope: string;
      active: { scriptURL: string };
      installing: null;
      waiting: typeof waitingWorker;
      update(): Promise<void>;
    };
    Object.assign(registration, {
      scope: `${window.location.origin}/`,
      active: { scriptURL: `${window.location.origin}/sw.js` },
      installing: null,
      waiting: waitingWorker,
      update: async () => undefined
    });
    Object.assign(serviceWorkerContainer, {
      controller: { state: "activated" },
      ready: Promise.resolve(registration),
      register: async () => registration,
      getRegistration: async () => registration
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: serviceWorkerContainer
    });
  });

  await page.goto("/student/dashboard");
  const updatePrompt = page.getByTestId("pwa-update-prompt");
  await expect(updatePrompt).toBeVisible();
  await updatePrompt.getByRole("button", { name: "Update now" }).click();

  await expect.poll(async () => {
    return page.evaluate(() => window.sessionStorage.getItem("pwa-update-message")).catch(() => null);
  }).toBe('{"type":"SKIP_WAITING"}');
});
