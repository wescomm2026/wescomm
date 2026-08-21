import { expect, test } from "@playwright/test";
import { dismissWelcomeGate } from "./helpers";

test("startup gate uses the WESCOMM logo animation without legacy welcome content", async ({ page }) => {
  await page.route(/\/api\/backend\/products(?:\?.*)?$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await route.continue();
  });

  const animationResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname === "/assets/wescomm-logo-intro.mp4"
  ));

  await page.goto("/student/dashboard", { waitUntil: "domcontentloaded" });

  await expect(
    page.locator('link[rel="preload"][as="video"][href="/assets/wescomm-logo-intro.mp4"]')
  ).toHaveCount(1);

  const gate = page.locator(".welcome-gate-overlay");
  await expect(gate).toBeVisible();
  expect(await gate.evaluate((element) => element.style.position)).toBe("fixed");
  expect(await gate.evaluate((element) => {
    const main = document.querySelector("main");
    return Boolean(
      main && (element.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING)
    );
  })).toBe(true);

  const animation = gate.getByTestId("welcome-logo-animation");
  await expect(animation).toHaveJSProperty("autoplay", true);
  await expect(animation).toHaveJSProperty("muted", true);
  await expect(animation).toHaveAttribute("src", "/assets/wescomm-logo-intro.mp4");
  const skipButton = gate.getByRole("button", { name: "Skip welcome animation and continue" });
  await expect(skipButton).toBeVisible();
  const skipButtonBox = await skipButton.boundingBox();
  const viewport = page.viewportSize();
  expect(skipButtonBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(skipButtonBox?.x ?? 0).toBeGreaterThan((viewport?.width ?? 0) * 0.65);
  expect(skipButtonBox?.y ?? 0).toBeGreaterThan((viewport?.height ?? 0) * 0.75);
  await expect(gate.getByRole("heading")).toHaveCount(0);
  await expect(gate.getByText(/Welcome (?:Back )?to WESCOMM/)).toHaveCount(0);
  expect([200, 206]).toContain((await animationResponse).status());

  await expect(gate).toHaveAttribute("data-animation-complete", "true");
  await expect(animation).toHaveJSProperty("paused", true);
  const heldFrame = await animation.evaluate((element) => {
    const video = element as HTMLVideoElement;
    return {
      currentTime: video.currentTime,
      duration: video.duration
    };
  });
  expect(heldFrame.duration - heldFrame.currentTime).toBeGreaterThan(0.6);

  await dismissWelcomeGate(page);
});

test("welcome animation can be skipped on every visit", async ({ page }) => {
  await page.route(/\/api\/backend\/products(?:\?.*)?$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    await route.continue();
  });

  await page.goto("/student/dashboard", { waitUntil: "domcontentloaded" });

  const gate = page.locator(".welcome-gate-overlay");
  await expect(gate).toBeVisible();
  await gate.getByRole("button", { name: "Skip welcome animation and continue" }).click();
  await expect(gate).toBeHidden({ timeout: 1500 });

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(gate).toBeVisible();
  await expect(gate.getByTestId("welcome-logo-animation")).toHaveAttribute(
    "src",
    "/assets/wescomm-logo-intro.mp4"
  );
  await gate.getByRole("button", { name: "Skip welcome animation and continue" }).click();
  await expect(gate).toBeHidden({ timeout: 1500 });
});

test("reduced-motion visitors bypass the welcome video", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  let animationRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/assets/wescomm-logo-intro.mp4") {
      animationRequests += 1;
    }
  });

  await page.goto("/student/dashboard", { waitUntil: "domcontentloaded" });

  await expect(page.locator(".welcome-gate-overlay")).toHaveCount(0);
  expect(animationRequests).toBe(0);
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
    await new Promise((resolve) => setTimeout(resolve, 900));
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
