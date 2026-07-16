import { expect, test } from "@playwright/test";
import { dismissWelcomeGate } from "./helpers";

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
