import { expect, test } from "@playwright/test";

test("cookie-authenticated API proxy writes require a present trusted Origin", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Proxy origin policy only needs one Chromium project.");

  await page.goto("/offline.html");
  const trustedOrigin = new URL(page.url()).origin;
  const endpoint = "/api/backend/qa-origin-policy-probe";
  const cookie = "wescomm_session=csrf-proxy-qa-session";

  const missingOrigin = await request.post(endpoint, {
    headers: { cookie }
  });
  expect(missingOrigin.status()).toBe(403);

  const maliciousOrigin = await request.post(endpoint, {
    headers: {
      cookie,
      origin: "https://malicious.example",
      "sec-fetch-site": "cross-site"
    }
  });
  expect(maliciousOrigin.status()).toBe(403);

  const trustedRequest = await request.post(endpoint, {
    headers: {
      cookie,
      origin: trustedOrigin,
      "sec-fetch-site": "same-origin"
    }
  });
  expect(trustedRequest.status()).toBe(404);
});

test("anonymous staff workspace navigation fails closed as not found", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Workspace route boundary only needs one Chromium project.");
  await page.goto("/staff");
  await expect(page.getByRole("heading", { name: "Oops! This page is not available." })).toBeVisible();
  await expect(page.getByRole("button", { name: /Sign in/i })).toHaveCount(0);
});
