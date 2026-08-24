import { expect, test, type Route } from "@playwright/test";

const studentProfile = {
  id: "00000000-0000-4000-8000-000000000101",
  role: "STUDENT",
  studentNumber: "2026-0101",
  fullName: "Boundary Test Student",
  email: "boundary.student@wesleyan.edu.ph",
  phone: null,
  department: "College of Engineering",
  address: null,
  avatarUrl: null
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

test("public and legal routes do not mount authenticated role providers", async ({ page }) => {
  let authRequests = 0;

  await page.route("**/api/backend/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/backend/auth/me") {
      authRequests += 1;
      await json(route, { profile: studentProfile });
      return;
    }
    if (path === "/api/backend/realtime/events") {
      await route.fulfill({ status: 200, contentType: "text/event-stream", body: "" });
      return;
    }
    if (path === "/api/backend/notifications/unread-count") {
      await json(route, { unreadCount: 0 });
      return;
    }
    if (path === "/api/backend/notifications") {
      await json(route, { notifications: [], nextCursor: null });
      return;
    }
    await json(route, {});
  });

  await page.goto("/privacy");
  await expect(page.getByRole("heading", { name: "Privacy Policy", level: 1 })).toBeVisible();
  await page.waitForTimeout(300);

  await page.goto("/verify-receipt");
  await expect(page.getByRole("heading", { name: "Search an official receipt" })).toBeVisible();
  await page.waitForTimeout(300);
  expect(authRequests, "public pages must not request the current authenticated user").toBe(0);

  await page.goto("/student/dashboard");
  await expect.poll(() => authRequests, {
    message: "student routes should mount the authenticated role provider"
  }).toBeGreaterThan(0);
});
