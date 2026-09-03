import { expect, test } from "@playwright/test";
import { loginWithDevelopmentAccount, revokeQaSession, TEST_PASSWORD } from "./helpers";

test.describe("admin role-change end-to-end flow", () => {
  test.describe.configure({ timeout: 120_000 });
  test.skip(!TEST_PASSWORD, "Set E2E_TEST_PASSWORD to run the reversible role mutation flow.");

  test.afterEach(async ({ page }) => {
    await revokeQaSession(page);
  });

  test("admin changes the test student to staff and restores student access", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "The destructive-but-reversible role flow runs once.");
    await loginWithDevelopmentAccount(page, "admin@wesleyan.edu.ph", /\/admin\/dashboard/);
    await page.goto("/admin/users");

    await page.getByPlaceholder("Search name, email, student number, or department").fill("student@wesleyan.edu.ph");
    const row = page.locator("article").filter({ hasText: "student@wesleyan.edu.ph" });
    await expect(row).toHaveCount(1);
    const roleSelect = row.locator("select");
    let restoreRequired = false;

    const waitForRoleResponse = () => page.waitForResponse((response) => (
      response.request().method() === "PATCH"
      && /\/api\/backend\/admin\/users\/[0-9a-f-]+\/role$/.test(new URL(response.url()).pathname)
    ));

    try {
      if (await roleSelect.inputValue() !== "STUDENT") {
        const recoveryResponse = waitForRoleResponse();
        await roleSelect.selectOption("STUDENT");
        expect((await recoveryResponse).status(), "The test account must be restored before the flow").toBe(200);
      }
      await expect(roleSelect).toHaveValue("STUDENT");

      const promoteResponse = waitForRoleResponse();
      await roleSelect.selectOption("STAFF");
      expect((await promoteResponse).status(), "STUDENT -> STAFF must succeed").toBe(200);
      restoreRequired = true;
      await expect(roleSelect).toHaveValue("STAFF");
      await expect(row.locator("span").filter({ hasText: /^Staff$/ })).toBeVisible();

      const restoreResponse = waitForRoleResponse();
      await roleSelect.selectOption("STUDENT");
      expect((await restoreResponse).status(), "STAFF -> STUDENT must succeed").toBe(200);
      restoreRequired = false;
      await expect(roleSelect).toHaveValue("STUDENT");
      await expect(row.locator("span").filter({ hasText: /^Student$/ })).toBeVisible();
    } finally {
      if (restoreRequired && !page.isClosed()) {
        const cleanupResponse = waitForRoleResponse();
        await roleSelect.selectOption("STUDENT").catch(() => undefined);
        await cleanupResponse.catch(() => undefined);
      }
    }
  });
});
