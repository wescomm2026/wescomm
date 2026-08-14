import { expect, test, type Route } from "@playwright/test";
import { dismissWelcomeGate } from "./helpers";

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

test("visitor receipt search normalizes the code and displays only masked details", async ({ page }) => {
  let requestedCode = "";

  await page.route("**/api/backend/**", async (route) => {
    const path = new URL(route.request().url()).pathname;

    if (path === "/api/backend/auth/me") {
      return json(route, { error: "Authentication required." }, 401);
    }
    if (path.startsWith("/api/backend/receipts/verify/")) {
      requestedCode = decodeURIComponent(path.split("/").at(-1) ?? "");
      return json(route, {
        receipt: {
          receiptCode: "RCT-2026-PUBLIC",
          totalAmount: "375.00",
          paymentMethod: "PAYMONGO_GCASH",
          status: "VERIFIED",
          issuedAt: "2026-08-14T02:00:00.000Z",
          student: {
            displayName: "J*** D.",
            studentNumber: "*******3456"
          },
          reservation: {
            referenceCode: "***********C123",
            status: "COMPLETED",
            itemCount: 2,
            totalQuantity: 3
          }
        }
      });
    }
    return json(route, { error: `Unexpected mocked request: ${path}` }, 500);
  });

  await page.goto("/verify-receipt");
  await dismissWelcomeGate(page);

  const input = page.getByLabel("Receipt code");
  await input.fill("rct-2026-public");
  await page.getByRole("button", { name: "Verify Receipt" }).click();

  await expect(page.getByRole("heading", { name: "RCT-2026-PUBLIC" })).toBeVisible();
  await expect(input).toHaveValue("RCT-2026-PUBLIC");
  await expect(page.getByText("J*** D.", { exact: true })).toBeVisible();
  await expect(page.getByText("*******3456", { exact: true })).toBeVisible();
  await expect(page.getByText("***********C123", { exact: true })).toBeVisible();
  await expect(page.getByText("2 line items / 3 total units", { exact: true })).toBeVisible();
  await expect(page.getByText("Verified", { exact: true })).toBeVisible();

  await expect(page.getByText("John Mark Doe", { exact: true })).toHaveCount(0);
  await expect(page.getByText("2026-123456", { exact: true })).toHaveCount(0);
  await expect(page.getByText("WES-2026-ABC123", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Private purchase item", { exact: true })).toHaveCount(0);
  expect(requestedCode).toBe("RCT-2026-PUBLIC");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
