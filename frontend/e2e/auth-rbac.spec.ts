import { expect, test } from "@playwright/test";
import { apiStatuses, loginWithDevelopmentAccount, revokeQaSession, TEST_PASSWORD } from "./helpers";

test.describe("development account role boundaries", () => {
  test.describe.configure({ timeout: 90_000 });
  test.skip(!TEST_PASSWORD, "Set E2E_TEST_PASSWORD to the backend AUTH_DEV_LOGIN_PASSWORD before running role tests.");

  test.afterEach(async ({ page }) => {
    await revokeQaSession(page);
  });

  test("student receives only student access and logout revokes the browser session", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Role matrix runs once in the desktop project.");
    await loginWithDevelopmentAccount(page, "student@wesleyan.edu.ph", /\/student\/dashboard/);

    const sessionCookie = (await page.context().cookies()).find((cookie) => cookie.name === "wescomm_session");
    expect(sessionCookie?.httpOnly).toBe(true);
    expect(sessionCookie?.sameSite).toBe("Lax");
    expect(sessionCookie?.path).toBe("/");

    const statuses = await apiStatuses(page, [
      "/api/backend/products",
      "/api/backend/staff/products",
      "/api/backend/admin/users"
    ]);
    expect(statuses["/api/backend/products"]).toBe(200);
    expect(statuses["/api/backend/staff/products"]).toBe(403);
    expect(statuses["/api/backend/admin/users"]).toBe(403);

    await page.getByRole("button", { name: /account menu/ }).click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect.poll(async () => (await apiStatuses(page, ["/api/backend/auth/me"]))["/api/backend/auth/me"]).toBe(401);
  });

  test("staff can operate inventory but cannot use admin-only user management", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Role matrix runs once in the desktop project.");
    await loginWithDevelopmentAccount(page, "staff@wesleyan.edu.ph", /\/staff\/?$/);

    const statuses = await apiStatuses(page, [
      "/api/backend/staff/products",
      "/api/backend/staff/users",
      "/api/backend/admin/users"
    ]);
    expect(statuses["/api/backend/staff/products"]).toBe(200);
    expect(statuses["/api/backend/staff/users"]).toBe(200);
    expect(statuses["/api/backend/admin/users"]).toBe(403);

    await page.goto("/student/dashboard");
    await expect(page).toHaveURL(/\/staff\/?$/, { timeout: 30_000 });
  });

  test("admin can use inventory and admin user-management APIs", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Role matrix runs once in the desktop project.");
    await loginWithDevelopmentAccount(page, "admin@wesleyan.edu.ph", /\/admin\/dashboard/);

    const statuses = await apiStatuses(page, [
      "/api/backend/staff/products",
      "/api/backend/admin/users",
      "/api/backend/admin/audit-logs"
    ]);
    expect(statuses["/api/backend/staff/products"]).toBe(200);
    expect(statuses["/api/backend/admin/users"]).toBe(200);
    expect(statuses["/api/backend/admin/audit-logs"]).toBe(200);

    await page.goto("/student/dashboard");
    await expect(page).toHaveURL(/\/admin\/dashboard$/, { timeout: 30_000 });
  });
});
