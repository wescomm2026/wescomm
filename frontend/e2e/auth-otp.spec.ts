import { expect, test, type Page } from "@playwright/test";
import { dismissWelcomeGate } from "./helpers";

const SCHOOL_EMAIL = "qa.personal@wesleyan.edu.ph";
const RATE_LIMIT_MESSAGE = "Too many verification-code requests. Please wait a minute and try again.";
const EMAIL_SERVICE_MESSAGE = "The email service is temporarily unavailable. Please try again in a few minutes or contact WESCOMM support.";
const INTERNAL_SMTP_ERROR = "SMTP authentication failed for qa-smtp-secret";

type CapturedOtpRequest = {
  method: string;
  url: string;
  body: Record<string, unknown>;
  hasApiKey: boolean;
  contentType: string;
};

type MockOtpResponse = {
  status: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
};

async function mockGuestSession(page: Page) {
  await page.route("**/api/backend/auth/me", (route) => route.fulfill({
    status: 401,
    contentType: "application/json",
    body: JSON.stringify({ error: "Authentication required." })
  }));
}

async function mockOtpResponse(page: Page, response: MockOtpResponse) {
  const requests: CapturedOtpRequest[] = [];

  await page.route("**/auth/v1/otp**", async (route) => {
    const request = route.request();
    const headers = request.headers();

    requests.push({
      method: request.method(),
      url: request.url(),
      body: request.postDataJSON() as Record<string, unknown>,
      hasApiKey: Boolean(headers.apikey),
      contentType: headers["content-type"] ?? ""
    });

    await route.fulfill({
      status: response.status,
      contentType: "application/json",
      headers: response.headers,
      body: JSON.stringify(response.body)
    });
  });

  return requests;
}

async function openLoginDialog(page: Page) {
  await page.goto("/student/dashboard?auth=login");
  await dismissWelcomeGate(page);

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Log in with your school email" })).toBeVisible();
  return dialog;
}

async function requestOtp(page: Page) {
  const dialog = await openLoginDialog(page);
  await dialog.getByRole("textbox").fill(SCHOOL_EMAIL);
  await dialog.getByRole("button", { name: "Send verification code" }).click();
  return dialog;
}

test.describe("personal school email OTP requests", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "OTP transport behavior runs once in the desktop project.");
    await mockGuestSession(page);
  });

  test("sends the normalized Supabase OTP contract and starts the resend cooldown", async ({ page }) => {
    const requests = await mockOtpResponse(page, { status: 200, body: {} });
    const dialog = await requestOtp(page);

    await expect(dialog.getByRole("heading", { name: "Enter verification code" })).toBeVisible();
    await expect(dialog.getByRole("status")).toHaveText("Verification code sent. Enter the full code from your inbox.");

    const resendButton = dialog.getByRole("button", { name: /Resend in \d+s/ });
    await expect(resendButton).toBeVisible();
    await expect(resendButton).toBeDisabled();

    expect(requests).toHaveLength(1);
    const [request] = requests;
    const requestUrl = new URL(request.url);

    expect(request.method).toBe("POST");
    expect(requestUrl.pathname).toBe("/auth/v1/otp");
    expect(requestUrl.searchParams.get("redirect_to")).toBe(`${new URL(page.url()).origin}/auth/callback`);
    expect(request.body).toMatchObject({
      email: SCHOOL_EMAIL,
      data: {},
      create_user: true
    });
    expect(request.body).not.toHaveProperty("phone");
    expect(request.hasApiKey).toBe(true);
    expect(request.contentType).toContain("application/json");
  });

  test("keeps the email step retryable when Supabase rate-limits OTP requests", async ({ page }) => {
    const requests = await mockOtpResponse(page, {
      status: 429,
      headers: {
        "retry-after": "60",
        "x-supabase-api-version": "2024-01-01"
      },
      body: {
        code: "over_email_send_rate_limit",
        message: RATE_LIMIT_MESSAGE
      }
    });
    const dialog = await requestOtp(page);

    await expect(dialog.getByRole("alert")).toHaveText(RATE_LIMIT_MESSAGE);
    await expect(dialog.getByRole("heading", { name: "Log in with your school email" })).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Enter verification code" })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: /Try again in \d+s/ })).toBeDisabled();
    expect(requests).toHaveLength(1);
  });

  test("shows a safe retryable error when the email provider fails", async ({ page }) => {
    const requests = await mockOtpResponse(page, {
      status: 500,
      body: {
        code: "email_provider_failure",
        message: INTERNAL_SMTP_ERROR
      }
    });
    const dialog = await requestOtp(page);
    const alert = dialog.getByRole("alert");

    await expect(alert).toHaveText(EMAIL_SERVICE_MESSAGE);
    await expect(alert).not.toContainText(/smtp|authentication|qa-smtp-secret/i);
    await expect(dialog.getByRole("heading", { name: "Log in with your school email" })).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Enter verification code" })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: /Try again in \d+s/ })).toBeDisabled();
    expect(requests).toHaveLength(1);
  });
});
