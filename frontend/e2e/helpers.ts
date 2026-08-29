import { expect, type Page } from "@playwright/test";

export const TEST_PASSWORD = process.env.E2E_TEST_PASSWORD?.trim() ?? "";

export async function authorizeMockedWorkspace(page: Page, role: "STAFF" | "ADMIN") {
  const frontendPort = Number(process.env.E2E_FRONTEND_PORT ?? 3100);
  const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${frontendPort}`;
  await page.context().addCookies([{
    name: "wescomm_e2e_workspace_role",
    value: role,
    url: baseURL,
    sameSite: "Lax"
  }]);
}

export async function dismissWelcomeGate(page: Page) {
  const gate = page.locator(".welcome-gate-overlay");
  const appeared = await gate.waitFor({ state: "visible", timeout: 4_000 }).then(() => true).catch(() => false);
  if (!appeared) return;

  const skipButton = gate.getByRole("button", { name: "Skip welcome animation and continue" });
  const canSkip = await Promise.all([
    skipButton.isVisible().catch(() => false),
    skipButton.isEnabled().catch(() => false)
  ]).then(([visible, enabled]) => visible && enabled);
  if (canSkip) {
    await skipButton.click({ timeout: 1_000 }).catch(() => undefined);
  }
  await expect(gate).toBeHidden({ timeout: 18_000 });
}

export async function loginWithDevelopmentAccount(
  page: Page,
  email: "student@wesleyan.edu.ph" | "staff@wesleyan.edu.ph" | "admin@wesleyan.edu.ph",
  expectedPath: RegExp
) {
  await page.goto("/student/dashboard?auth=login");
  await dismissWelcomeGate(page);

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Log in with your school email" })).toBeVisible();
  await dialog.getByRole("textbox").fill(email.split("@")[0]);
  await dialog.getByRole("button", { name: "Continue to password" }).click();

  await expect(dialog.getByRole("heading", { name: "Enter account password" })).toBeVisible();
  await dialog.getByLabel("Password").fill(TEST_PASSWORD);
  const loginResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "POST"
      && /\/auth\/(?:dev-login|temporary-staff-login)$/.test(url.pathname);
  });
  await dialog.getByRole("button", { name: "Sign in" }).click();

  const loginResponse = await loginResponsePromise;
  expect(loginResponse.status(), "development login should establish a server session").toBe(200);
  await loginResponse.finished();
  await expect(dialog).toBeHidden({ timeout: 45_000 });
  await expect(page).toHaveURL(expectedPath, { timeout: 45_000 });
  await dismissWelcomeGate(page);
}

export async function apiStatuses(page: Page, paths: string[]) {
  return page.evaluate(async (requestPaths) => {
    const entries = await Promise.all(
      requestPaths.map(async (path) => {
        const response = await fetch(path, { credentials: "include" });
        return [path, response.status] as const;
      })
    );
    return Object.fromEntries(entries) as Record<string, number>;
  }, paths);
}

export async function revokeQaSession(page: Page) {
  await page.evaluate(async () => {
    await fetch("/api/backend/auth/logout", {
      method: "POST",
      credentials: "include"
    }).catch(() => undefined);
  }).catch(() => undefined);
}
