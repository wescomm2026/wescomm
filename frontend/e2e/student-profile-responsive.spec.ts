import { expect, test, type Page, type Route } from "@playwright/test";
import { dismissWelcomeGate } from "./helpers";

const longStudentProfile = {
  id: "70000000-0000-4000-8000-000000000001",
  role: "STUDENT",
  studentNumber: "WESLEYAN-2026-VERY-LONG-STUDENT-NUMBER-000001",
  fullName: "Alexandria Cassandra Montgomery-Wesleyan",
  email: "alexandria.cassandra.montgomery-wesleyan@wesleyan.edu.ph",
  phone: "+63 999 888 7777",
  department: "College of Engineering and Computer Technology",
  address: "A deliberately long student address used to confirm that profile content wraps safely on a narrow mobile screen.",
  avatarUrl: null
};

function json(route: Route, body: unknown) {
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}

async function mockProfileApis(page: Page) {
  await page.route("**/api/backend/**", async (route) => {
    const path = new URL(route.request().url()).pathname;

    if (path === "/api/backend/auth/me") {
      await json(route, { profile: longStudentProfile });
      return;
    }
    if (path === "/api/backend/reservations") {
      await json(route, { reservations: [] });
      return;
    }
    if (path === "/api/backend/receipts") {
      await json(route, { receipts: [] });
      return;
    }
    if (path === "/api/backend/notifications") {
      await json(route, { notifications: [], nextCursor: null });
      return;
    }
    if (path === "/api/backend/notifications/unread-count") {
      await json(route, { unreadCount: 0 });
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
    if (path === "/api/backend/push/public-key") {
      await json(route, { enabled: false, publicKey: "" });
      return;
    }
    if (path === "/api/backend/realtime/events") {
      await route.fulfill({ status: 200, contentType: "text/event-stream", body: "" });
      return;
    }

    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "Not found." }) });
  });
}

test("profile settings fit a narrow phone and keep install help available", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "One Chromium viewport covers this responsive regression.");

  await page.setViewportSize({ width: 320, height: 780 });
  await mockProfileApis(page);
  await page.goto("/student/profile");
  await dismissWelcomeGate(page);

  await expect(page.getByRole("heading", { name: "My Profile", level: 1 })).toBeVisible();
  await expect(page.getByText(longStudentProfile.email, { exact: true })).toBeVisible();
  await expect(page.getByTestId("profile-install-card")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  await page.getByRole("button", { name: "Show install steps" }).click();
  await expect(page.getByText("Install from your mobile browser", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
