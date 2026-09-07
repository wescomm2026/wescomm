import { expect, test, type Route } from "@playwright/test";
import { dismissWelcomeGate } from "./helpers";

const studentId = "87000000-0000-4000-8000-000000000001";
const departmentId = "87000000-0000-4000-8000-000000000002";
const incompleteProfile = {
  id: studentId,
  role: "STUDENT",
  studentNumber: null,
  departmentId: null,
  onboardingCompletedAt: null,
  fullName: "Onboarding QA Student",
  email: "onboarding.qa@wesleyan.edu.ph",
  phone: null,
  department: null,
  address: null,
  avatarUrl: null
} as const;

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

test("first-login onboarding requires Department and Student ID and permits optional-field skips", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "One onboarding flow is sufficient.");
  let submitted: Record<string, unknown> | null = null;

  await page.route("**/api/backend/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/backend/auth/me") return json(route, { profile: incompleteProfile });
    if (path === "/api/backend/auth/departments") return json(route, { departments: [{ id: departmentId, code: "CON", groupName: "College", displayName: "College of Nursing (CON)" }] });
    if (path === "/api/backend/auth/onboarding" && request.method() === "POST") {
      submitted = request.postDataJSON();
      return json(route, {
        profile: {
          ...incompleteProfile,
          studentNumber: "2026-0001",
          departmentId,
          onboardingCompletedAt: "2026-09-07T08:00:00.000Z",
          department: "College of Nursing (CON)"
        }
      });
    }
    if (path === "/api/backend/restrictions/me") return json(route, { restrictionSummary: { activeRestriction: null, consecutiveOffenses: 0, offenses: [], policy: { firstRestrictionAt: 3 } } });
    if (path === "/api/backend/notifications") return json(route, { notifications: [], nextCursor: null });
    if (path === "/api/backend/notifications/unread-count") return json(route, { unreadCount: 0 });
    if (path === "/api/backend/push/public-key") return json(route, { enabled: false, publicKey: "" });
    if (path === "/api/backend/products") return json(route, { products: [] });
    if (path === "/api/backend/reservations") return json(route, { items: [], nextCursor: null });
    if (path === "/api/backend/receipts") return json(route, { items: [], nextCursor: null });
    if (path === "/api/backend/realtime/events") return route.fulfill({ status: 200, contentType: "text/event-stream", body: "" });
    return json(route, { error: `Unexpected mocked request: ${request.method()} ${path}` }, 404);
  });

  await page.goto("/student/dashboard");
  await dismissWelcomeGate(page);
  await expect(page.getByRole("heading", { name: "Department" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Continue/ })).toBeDisabled();
  await page.getByRole("combobox", { name: /department/i }).selectOption(departmentId);
  await page.getByRole("button", { name: /Continue/ }).click();

  await expect(page.getByRole("heading", { name: "Student ID" })).toBeVisible();
  await page.getByRole("textbox", { name: /Student ID Number/i }).fill("2026-0001");
  await page.getByRole("button", { name: /Continue/ }).click();
  await expect(page.getByRole("heading", { name: "Phone" })).toBeVisible();
  await page.getByRole("button", { name: "Skip" }).click();
  await expect(page.getByRole("heading", { name: "Address" })).toBeVisible();
  await page.getByRole("button", { name: "Skip" }).click();

  await expect(page).toHaveURL(/\/student\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Department" })).toHaveCount(0);
  expect(submitted).toEqual({ departmentId, studentNumber: "2026-0001", phone: null, address: null });
});
