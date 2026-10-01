import { expect, test, type Page, type Route } from "@playwright/test";
import { dismissWelcomeGate } from "./helpers";

const currentDepartmentId = "87000000-0000-4000-8000-000000000001";
const nursingDepartmentId = "87000000-0000-4000-8000-000000000002";

const longStudentProfile = {
  id: "70000000-0000-4000-8000-000000000001",
  role: "STUDENT",
  studentNumber: "WESLEYAN-2026-VERY-LONG-STUDENT-NUMBER-000001",
  departmentId: currentDepartmentId,
  onboardingCompletedAt: "2026-09-01T00:00:00.000Z",
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

async function mockProfileApis(page: Page, onProfileUpdate?: (payload: Record<string, unknown>) => void) {
  await page.route("**/api/backend/**", async (route) => {
    const path = new URL(route.request().url()).pathname;

    if (path === "/api/backend/auth/me") {
      if (route.request().method() === "PATCH") {
        const payload = route.request().postDataJSON() as Record<string, unknown>;
        onProfileUpdate?.(payload);
        await json(route, {
          profile: {
            ...longStudentProfile,
            ...payload,
            department: payload.departmentId === nursingDepartmentId
              ? "College of Nursing (CON)"
              : longStudentProfile.department
          }
        });
        return;
      }
      await json(route, { profile: longStudentProfile });
      return;
    }
    if (path === "/api/backend/auth/departments") {
      await json(route, {
        departments: [
          { id: currentDepartmentId, code: "CECT", groupName: "College", displayName: longStudentProfile.department },
          { id: nursingDepartmentId, code: "CON", groupName: "College", displayName: "College of Nursing (CON)" }
        ]
      });
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
    if (path === "/api/backend/realtime/updates") {
      await json(route, { cursor: "0", hasMore: false, events: [] });
      return;
    }

    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "Not found." }) });
  });
}

test("profile settings fit a narrow phone and keep install help available", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "One Chromium viewport covers this responsive regression.");

  await page.setViewportSize({ width: 320, height: 780 });
  let submittedProfile: Record<string, unknown> | undefined;
  await mockProfileApis(page, (payload) => { submittedProfile = payload; });
  await page.goto("/student/profile");
  await dismissWelcomeGate(page);

  await expect(page.getByRole("heading", { name: "My Profile", level: 1 })).toBeVisible();
  await expect(page.getByText(longStudentProfile.email, { exact: true })).toBeVisible();
  await expect(page.getByTestId("profile-install-card")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  await page.getByRole("button", { name: "Show install steps" }).click();
  await expect(page.getByText("Install from your mobile browser", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  await page.getByRole("button", { name: "Edit Profile" }).click();
  await page.getByRole("textbox", { name: "Student Number" }).fill(" 2026 - 9001 ");
  await page.getByRole("combobox", { name: "Department" }).selectOption(nursingDepartmentId);
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page.getByRole("status").filter({ hasText: "Profile changes saved." })).toBeVisible();
  await expect(page.getByText("Student No. 2026-9001", { exact: true })).toBeVisible();
  await expect(page.getByText("College of Nursing (CON)", { exact: true })).toBeVisible();
  expect(submittedProfile).toMatchObject({
    studentNumber: "2026-9001",
    departmentId: nursingDepartmentId
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
