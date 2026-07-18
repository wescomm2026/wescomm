import { expect, test, type Page, type Route } from "@playwright/test";
import { dismissWelcomeGate } from "./helpers";

type AuthMode = "authenticated" | "transient" | "revoked";

const studentProfile = {
  id: "50000000-0000-4000-8000-000000000001",
  role: "STUDENT",
  studentNumber: "QA-SESSION-001",
  fullName: "Session QA Student",
  email: "session.qa@wesleyan.edu.ph",
  phone: null,
  department: "Quality Assurance",
  address: null,
  avatarUrl: null
};

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body)
  });
}

async function mockSessionApis(
  page: Page,
  readAuthMode: () => AuthMode,
  countAuthRequest: () => void,
  readAuthDelay: () => number
) {
  await page.route("**/api/backend/**", async (route) => {
    const path = new URL(route.request().url()).pathname;

    if (path === "/api/backend/auth/me") {
      countAuthRequest();
      const delay = readAuthDelay();
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));

      const mode = readAuthMode();
      if (mode === "authenticated") {
        await json(route, { profile: studentProfile });
      } else if (mode === "revoked") {
        await json(route, { error: "Session is invalid or expired." }, 401);
      } else {
        await json(route, { error: "WESCOMM services are temporarily unavailable." }, 503);
      }
      return;
    }

    if (path === "/api/backend/auth/logout") {
      await json(route, { success: true });
      return;
    }

    if (path === "/api/backend/products") {
      await json(route, { products: [] });
      return;
    }
    if (path === "/api/backend/restrictions/me") {
      await json(route, {
        restrictionSummary: {
          activeRestriction: null,
          consecutiveOffenses: 0,
          offenses: [],
          policy: { firstRestrictionAt: 3 }
        }
      });
      return;
    }
    if (path === "/api/backend/notifications") {
      await json(route, { notifications: [] });
      return;
    }
    if (path === "/api/backend/push/public-key") {
      await json(route, { enabled: false, publicKey: "" });
      return;
    }

    await json(route, { error: "Not mocked for this focused session test." }, 404);
  });
}

test("session revalidation recovers after a transient outage, deduplicates events, and clears a revoked session", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Session lifecycle coverage only needs one Chromium project.");

  let authMode: AuthMode = "transient";
  let authDelay = 0;
  let authRequestCount = 0;
  await mockSessionApis(
    page,
    () => authMode,
    () => { authRequestCount += 1; },
    () => authDelay
  );

  await page.goto("/student/dashboard");
  await dismissWelcomeGate(page);
  await expect(page.getByRole("button", { name: "Session QA Student account menu" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Log in", exact: true }).first()).toBeVisible();
  expect(authRequestCount).toBe(1);

  authMode = "authenticated";
  authDelay = 250;
  const requestsBeforeReconnect = authRequestCount;
  await page.evaluate(() => {
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
  });

  const accountMenu = page.getByRole("button", { name: "Session QA Student account menu" });
  await expect(accountMenu).toBeVisible();
  await expect.poll(() => authRequestCount).toBe(requestsBeforeReconnect + 1);

  authMode = "transient";
  authDelay = 0;
  const requestsBeforeTransientFailure = authRequestCount;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => authRequestCount).toBe(requestsBeforeTransientFailure + 1);
  await expect(accountMenu).toBeVisible();

  authMode = "revoked";
  const requestsBeforeRevocation = authRequestCount;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => authRequestCount).toBe(requestsBeforeRevocation + 1);
  await expect(accountMenu).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Log in", exact: true }).first()).toBeVisible();
});

test("an older profile response cannot restore the user after logout", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Session lifecycle coverage only needs one Chromium project.");

  let authMode: AuthMode = "authenticated";
  let authDelay = 0;
  let authRequestCount = 0;
  await mockSessionApis(
    page,
    () => authMode,
    () => { authRequestCount += 1; },
    () => authDelay
  );

  await page.goto("/student/dashboard");
  await dismissWelcomeGate(page);
  const accountMenu = page.getByRole("button", { name: "Session QA Student account menu" });
  await expect(accountMenu).toBeVisible();

  authDelay = 500;
  const requestsBeforeRace = authRequestCount;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => authRequestCount).toBe(requestsBeforeRace + 1);

  await accountMenu.click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("button", { name: "Log in", exact: true }).first()).toBeVisible();
  await page.waitForTimeout(650);
  await expect(accountMenu).toHaveCount(0);
});
