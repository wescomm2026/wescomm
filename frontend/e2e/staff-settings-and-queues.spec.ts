import { expect, test, type Route } from "@playwright/test";
import type { BackendAuthProfile } from "../lib/api";
import { authorizeMockedWorkspace, dismissWelcomeGate } from "./helpers";

const staffProfile: BackendAuthProfile = {
  id: "96000000-0000-4000-8000-000000000001",
  role: "STAFF",
  studentNumber: null,
  fullName: "Settings QA Staff",
  email: "settings.staff@wesleyan.edu.ph",
  phone: null,
  department: "Commissary",
  departmentId: null,
  onboardingCompletedAt: null,
  address: null,
  avatarUrl: null
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

test("staff settings load saved values, persist changes, and the sidebar shows live queue counts", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "One settings persistence contract is sufficient.");
  let preferences = { lowStock: true, reservations: true, receipts: false };
  let guidance = { text: "Bring your school ID when collecting items.", updatedAt: "2026-10-01T02:00:00.000Z", updatedBy: "Another Staff" };
  const preferenceSaves: unknown[] = [];
  const guidanceSaves: unknown[] = [];
  const unhandled: string[] = [];
  await authorizeMockedWorkspace(page, "STAFF");

  await page.route("**/api/backend/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/backend/auth/me") return json(route, { profile: staffProfile });
    if (path === "/api/backend/auth/departments") return json(route, { departments: [] });
    if (path === "/api/backend/notifications") return json(route, { notifications: [], nextCursor: null });
    if (path === "/api/backend/notifications/unread-count") return json(route, { unreadCount: 0 });
    if (path === "/api/backend/realtime/updates") return json(route, { cursor: "0", hasMore: false, events: [] });
    if (path === "/api/backend/push/public-key" || path.startsWith("/api/backend/push/")) return json(route, { publicKey: null, enabled: false });
    if (path === "/api/backend/staff/dashboard/summary") {
      return json(route, {
        dashboard: {
          products: [],
          reservations: [],
          receipts: [],
          metrics: { totalProducts: 12, itemsToRestock: 4, pendingReservations: 3, activeReservations: 5, receiptsToVerify: 2, openConversations: 0 }
        }
      });
    }
    if (path === "/api/backend/staff/settings/notification-preferences") {
      if (request.method() === "PUT") {
        preferences = request.postDataJSON();
        preferenceSaves.push(preferences);
      }
      return json(route, { preferences, updatedAt: "2026-10-05T01:00:00.000Z" });
    }
    if (path === "/api/backend/staff/settings/pickup-guidance") {
      if (request.method() === "PUT") {
        const body = request.postDataJSON() as { text: string };
        guidanceSaves.push(body);
        guidance = { text: body.text, updatedAt: "2026-10-05T01:00:00.000Z", updatedBy: staffProfile.fullName };
      }
      return json(route, { guidance });
    }
    unhandled.push(`${request.method()} ${path}`);
    return json(route, { error: "Unexpected API request in settings test." }, 500);
  });

  await page.goto("/staff/settings");
  await dismissWelcomeGate(page);
  await expect(page.getByRole("heading", { name: "Account settings" })).toBeVisible();

  const sidebar = page.getByRole("navigation", { name: "Workspace" }).first();
  await expect(sidebar.getByRole("link", { name: "Reservations 3 pending review" })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Receipt Verification 2 waiting for verification" })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Inventory 4 items to restock" })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Messages", exact: true })).toBeVisible();

  const saveButton = page.getByRole("button", { name: "Save changes" });
  const receiptSwitch = page.getByRole("switch", { name: "Receipt verification queue" });
  const restockSwitch = page.getByRole("switch", { name: "Restock alerts" });
  const guidanceField = page.getByLabel("Pickup guidance");
  await expect(receiptSwitch).toHaveAttribute("aria-checked", "false");
  await expect(guidanceField).toHaveValue(guidance.text);
  await expect(page.getByText(/Last updated .* by Another Staff/)).toBeVisible();
  await expect(saveButton).toBeDisabled();

  await restockSwitch.click();
  await guidanceField.fill("Bring your school ID and reference number.");
  await expect(page.getByText("You have unsaved changes.")).toBeVisible();
  await saveButton.click();
  await expect(page.getByText("Account settings saved.")).toBeVisible();
  await expect(saveButton).toBeDisabled();
  expect(preferenceSaves).toEqual([{ lowStock: false, reservations: true, receipts: false }]);
  expect(guidanceSaves).toEqual([{ text: "Bring your school ID and reference number." }]);

  await page.reload();
  await dismissWelcomeGate(page);
  await expect(page.getByRole("switch", { name: "Restock alerts" })).toHaveAttribute("aria-checked", "false");
  await expect(page.getByLabel("Pickup guidance")).toHaveValue("Bring your school ID and reference number.");
  expect(unhandled).toEqual([]);
});
