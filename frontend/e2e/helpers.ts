import { expect, type Page, type Route } from "@playwright/test";

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
  await dialog.getByRole("checkbox", { name: /I agree to the Terms & Conditions/ }).check();
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

const EMPTY_STAFF_DASHBOARD_SUMMARY = {
  dashboard: {
    products: [],
    reservations: [],
    receipts: [],
    metrics: { totalProducts: 0, itemsToRestock: 0, pendingReservations: 0, activeReservations: 0, receiptsToVerify: 0, openConversations: 0 }
  }
};

const DEFAULT_PICKUP_GUIDANCE = {
  guidance: {
    text: "Reservations are held until the selected pickup schedule. Unclaimed items are released after one business day.",
    updatedAt: null,
    updatedBy: null
  }
};

/** Answers the Staff/Admin shell's background requests (nav queue counts, shared pickup guidance). */
export async function fulfillWorkspaceShellExtras(route: Route) {
  const request = route.request();
  if (request.method() !== "GET") return false;
  const path = new URL(request.url()).pathname;
  const body = path === "/api/backend/staff/dashboard/summary"
    ? EMPTY_STAFF_DASHBOARD_SUMMARY
    : path === "/api/backend/staff/settings/pickup-guidance"
      ? DEFAULT_PICKUP_GUIDANCE
      : null;
  if (!body) return false;
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  return true;
}

/**
 * Mocks GET /student/overview for student pages. Counts are derived from the spec's own
 * fixtures so tab counts and totals stay consistent with the mocked lists.
 */
export async function fulfillStudentOverview(
  route: Route,
  reservations: Array<{ status: string }> = [],
  receipts: Array<{ status: string }> = []
) {
  if (new URL(route.request().url()).pathname !== "/api/backend/student/overview") return false;
  const reservationCounts: Record<string, number> = { PENDING: 0, CONFIRMED: 0, READY_FOR_PICKUP: 0, COMPLETED: 0, CANCELLED: 0, NO_SHOW: 0 };
  for (const reservation of reservations) reservationCounts[reservation.status] = (reservationCounts[reservation.status] ?? 0) + 1;
  const receiptCounts: Record<string, number> = { PENDING: 0, VERIFIED: 0, VOIDED: 0 };
  for (const receipt of receipts) receiptCounts[receipt.status] = (receiptCounts[receipt.status] ?? 0) + 1;
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      overview: {
        generatedAt: new Date().toISOString(),
        reservations: {
          ...reservationCounts,
          total: reservations.length,
          active: reservationCounts.PENDING + reservationCounts.CONFIRMED + reservationCounts.READY_FOR_PICKUP
        },
        receipts: { ...receiptCounts, total: receipts.length },
        spentThisMonth: 0,
        nextPickup: null,
        pickupGuidance: null
      }
    })
  });
  return true;
}
