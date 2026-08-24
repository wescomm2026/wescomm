import { expect, test } from "@playwright/test";
import { dismissWelcomeGate } from "./helpers";

const WELCOME_VIDEO_PATH = "/assets/wescomm-logo-intro-new.mp4";

test("fresh app session shows the responsive welcome animation while dashboard data loads", async ({ page }) => {
  let animationRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === WELCOME_VIDEO_PATH) animationRequests += 1;
  });
  await page.route(/\/api\/backend\/products(?:\?.*)?$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await route.continue();
  });

  await page.goto("/student/dashboard", { waitUntil: "domcontentloaded" });

  await expect.poll(() => page.evaluate(() => ({
    state: document.documentElement.getAttribute("data-wescomm-intro"),
    seen: window.sessionStorage.getItem("wescomm_welcome_intro_v2_seen"),
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches
  }))).toEqual({ state: "pending", seen: "1", reducedMotion: false });
  const gate = page.locator(".welcome-gate-overlay");
  await expect(gate).toBeVisible();
  await expect(gate).toHaveCSS("position", "fixed");
  await expect(gate).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(page.getByTestId("welcome-logo-animation")).toHaveJSProperty("muted", false);
  await expect(page.getByTestId("welcome-logo-animation")).toHaveJSProperty("volume", 1);
  await expect.poll(() => animationRequests).toBeGreaterThan(0);
  await expect(page.getByRole("heading", { name: "Stock Status Overview" })).toBeVisible();
  await dismissWelcomeGate(page);
});

test("reload and same-tab navigation stay free of the welcome gate", async ({ page }) => {
  let animationRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === WELCOME_VIDEO_PATH) animationRequests += 1;
  });

  await page.goto("/student/dashboard", { waitUntil: "domcontentloaded" });
  const gate = page.locator(".welcome-gate-overlay");
  await expect(gate).toBeVisible();
  await expect.poll(() => animationRequests).toBeGreaterThan(0);
  await dismissWelcomeGate(page);
  await page.waitForTimeout(500);
  const firstOpenRequestCount = animationRequests;

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(gate).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(animationRequests).toBe(firstOpenRequestCount);

  await page.goto("/student/shop", { waitUntil: "domcontentloaded" });
  await expect(gate).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(animationRequests).toBe(firstOpenRequestCount);
});

test("reduced-motion visitors bypass the welcome video", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  let animationRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === WELCOME_VIDEO_PATH) {
      animationRequests += 1;
    }
  });

  await page.goto("/student/dashboard", { waitUntil: "domcontentloaded" });

  await expect(page.locator(".welcome-gate-overlay")).toHaveCount(0);
  expect(animationRequests).toBe(0);
});

test("failed welcome media exits safely and is not retried on reload", async ({ page }) => {
  let animationRequests = 0;
  await page.route(`**${WELCOME_VIDEO_PATH}`, async (route) => {
    animationRequests += 1;
    await route.abort("failed");
  });

  await page.goto("/student/dashboard", { waitUntil: "domcontentloaded" });

  await expect(page.locator(".welcome-gate-overlay")).toHaveCount(0);
  await expect.poll(() => animationRequests).toBe(1);
  await expect.poll(() => page.evaluate(() => (
    window.sessionStorage.getItem("wescomm_welcome_intro_v2_seen")
  ))).toBe("1");

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".welcome-gate-overlay")).toHaveCount(0);
  expect(animationRequests).toBe(1);
});

test("student dashboard shares one products request across its loading cards", async ({ page }) => {
  let productsRequestCount = 0;
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.endsWith("/api/backend/products") || pathname === "/api/products") {
      productsRequestCount += 1;
    }
  });

  await page.goto("/student/dashboard");
  await dismissWelcomeGate(page);

  await expect(page.getByRole("heading", { name: "Stock Status Overview" })).toBeVisible();
  await expect(page.getByText("Loading live stock status.")).toBeHidden();
  await expect.poll(() => productsRequestCount).toBe(1);
});

test("email OTP uses the delayed compact action loader", async ({ page }) => {
  await page.route(/\/auth\/v1\/otp(?:\?.*)?$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_600));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "{}"
    });
  });

  await page.goto("/student/dashboard?auth=login");
  await dismissWelcomeGate(page);

  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").fill("loading.qa");
  await dialog.getByRole("button", { name: "Send verification code" }).click();

  const loader = dialog.locator('[role="status"][aria-busy="true"]');
  await expect(loader.getByText("Sending verification code")).toBeVisible();
  await expect(loader.getByText("Your secure code is being sent to your school email.")).toBeVisible();
  await expect(loader.getByText("Checking email limit")).toHaveCount(0);

  await expect(dialog.getByRole("heading", { name: "Enter verification code" })).toBeVisible();
  await expect(loader).toBeHidden();
});
