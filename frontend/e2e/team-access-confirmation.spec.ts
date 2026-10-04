import { expect, test, type Route } from "@playwright/test";
import type { BackendAdminUser, BackendAuthProfile } from "../lib/api";
import { authorizeMockedWorkspace, dismissWelcomeGate, fulfillWorkspaceShellExtras } from "./helpers";

const adminProfile: BackendAuthProfile = {
  id: "95000000-0000-4000-8000-000000000001",
  role: "ADMIN",
  studentNumber: null,
  fullName: "Team Access QA Admin",
  email: "team.admin@wesleyan.edu.ph",
  phone: null,
  department: "Commissary",
  departmentId: null,
  onboardingCompletedAt: null,
  address: null,
  avatarUrl: null
};

function account(overrides: Partial<BackendAdminUser>): BackendAdminUser {
  return {
    id: "95000000-0000-4000-8000-000000000099",
    fullName: "Account",
    email: "account@wesleyan.edu.ph",
    studentNumber: null,
    phone: null,
    department: null,
    role: "STUDENT",
    avatarUrl: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides
  };
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

test("Team Access requires confirmation before changing a role and warns before self-demotion", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "One role-confirmation contract is sufficient.");
  const student = account({
    id: "95000000-0000-4000-8000-000000000002",
    fullName: "Team Access QA Student",
    email: "team.student@wesleyan.edu.ph",
    studentNumber: "2026-00042",
    department: "College of Nursing"
  });
  const self = account({ id: adminProfile.id, fullName: adminProfile.fullName, email: adminProfile.email, role: "ADMIN", department: "Commissary" });
  const roleUpdates: Array<{ userId: string; role: string }> = [];
  const unhandled: string[] = [];
  await authorizeMockedWorkspace(page, "ADMIN");

  await page.route("**/api/backend/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/backend/auth/me") return json(route, { profile: adminProfile });
    if (path === "/api/backend/auth/departments") return json(route, { departments: [] });
    if (path === "/api/backend/notifications") return json(route, { notifications: [], nextCursor: null });
    if (path === "/api/backend/notifications/unread-count") return json(route, { unreadCount: 0 });
    if (path === "/api/backend/realtime/updates") return json(route, { cursor: "0", hasMore: false, events: [] });
    if (await fulfillWorkspaceShellExtras(route)) return;
    if (path === "/api/backend/admin/users" && request.method() === "GET") {
      return json(route, { items: [self, student], nextCursor: null, roleCounts: { students: 1, staff: 0, admins: 1 } });
    }
    const roleMatch = path.match(/^\/api\/backend\/admin\/users\/([0-9a-f-]+)\/role$/);
    if (roleMatch && request.method() === "PATCH") {
      const { role } = request.postDataJSON() as { role: BackendAdminUser["role"] };
      roleUpdates.push({ userId: roleMatch[1], role });
      const target = roleMatch[1] === student.id ? student : self;
      return json(route, { user: { ...target, role } });
    }
    unhandled.push(`${request.method()} ${path}`);
    return json(route, { error: "Unexpected API request in Team Access test." }, 500);
  });

  await page.goto("/admin/users");
  await dismissWelcomeGate(page);
  await expect(page.getByRole("heading", { name: "Account access management" })).toBeVisible();

  const studentRow = page.locator("article").filter({ hasText: student.email });
  const studentSelect = studentRow.getByRole("combobox", { name: `Change role for ${student.fullName}` });
  await expect(studentSelect).toHaveValue("STUDENT");

  // Cancelling leaves the account untouched and the select on its saved value.
  await studentSelect.selectOption("STAFF");
  const promoteDialog = page.getByRole("alertdialog", { name: `Change ${student.fullName}'s role to Staff?` });
  await expect(promoteDialog).toBeVisible();
  await expect(promoteDialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await promoteDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(promoteDialog).toBeHidden();
  await expect(studentSelect).toHaveValue("STUDENT");
  expect(roleUpdates).toEqual([]);

  // Confirming saves exactly one role change and updates the row and counts.
  await studentSelect.selectOption("STAFF");
  await promoteDialog.getByRole("button", { name: "Change role", exact: true }).click();
  await expect(studentSelect).toHaveValue("STAFF");
  await expect(studentRow.locator("span").filter({ hasText: /^Staff$/ })).toBeVisible();
  await expect(page.getByText(`${student.email} role updated to STAFF.`)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Staff\s*1$/ })).toBeVisible();
  expect(roleUpdates).toEqual([{ userId: student.id, role: "STAFF" }]);

  // Demoting your own account explains that admin access will be lost.
  const selfSelect = page.locator("article").filter({ hasText: self.email }).getByRole("combobox");
  await selfSelect.selectOption("STAFF");
  const selfDialog = page.getByRole("alertdialog", { name: `Change ${self.fullName}'s role to Staff?` });
  await expect(selfDialog.getByText(/This is your own account: you will lose admin access/)).toBeVisible();
  await selfDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(selfSelect).toHaveValue("ADMIN");
  expect(roleUpdates).toHaveLength(1);
  expect(unhandled).toEqual([]);
});
