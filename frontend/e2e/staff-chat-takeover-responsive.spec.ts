import { expect, test, type Page, type Route } from "@playwright/test";
import type { BackendAuthProfile, BackendConversation } from "../lib/api";
import { dismissWelcomeGate } from "./helpers";

const staffId = "00000000-0000-4000-8000-000000000021";
const otherStaffId = "00000000-0000-4000-8000-000000000022";
const studentId = "00000000-0000-4000-8000-000000000023";
const conversationId = "00000000-0000-4000-8000-000000000024";

const staffProfile: BackendAuthProfile = {
  id: staffId,
  role: "STAFF",
  studentNumber: null,
  fullName: "QA Staff",
  email: "qa.staff@wesleyan.edu.ph",
  phone: null,
  department: "Commissary",
  address: null,
  avatarUrl: null
};

function supportConversation(mode: "BOT_ACTIVE" | "STAFF_ACTIVE"): BackendConversation {
  const handled = mode === "STAFF_ACTIVE";
  return {
    id: conversationId,
    studentId,
    assignedStaffId: handled ? otherStaffId : null,
    subject: "Mobile uniform support",
    status: "OPEN",
    mode,
    category: "PRODUCT_AVAILABILITY",
    priority: 0,
    escalationReason: null,
    escalatedAt: null,
    acceptedAt: handled ? "2026-08-21T08:01:00.000Z" : null,
    resolvedAt: null,
    botSummary: null,
    lastIntent: "PRODUCT_INQUIRY",
    botReplyCount: 1,
    createdAt: "2026-08-21T08:00:00.000Z",
    updatedAt: "2026-08-21T08:01:00.000Z",
    student: {
      id: studentId,
      fullName: "Mobile QA Student",
      email: "mobile.student@wesleyan.edu.ph",
      studentNumber: "2026-0023"
    },
    assignedStaff: handled ? {
      id: otherStaffId,
      fullName: "Other Staff",
      email: "other.staff@wesleyan.edu.ph"
    } : null,
    messages: [{
      id: "00000000-0000-4000-8000-000000000025",
      conversationId,
      senderId: studentId,
      senderType: "STUDENT",
      message: "May extra long product name or link na hindi dapat mag-overflow: https://example.test/this-is-a-very-long-unbroken-support-message-value",
      createdAt: "2026-08-21T08:01:00.000Z",
      sender: {
        id: studentId,
        fullName: "Mobile QA Student",
        email: "mobile.student@wesleyan.edu.ph"
      }
    }],
    typingUsers: []
  };
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function mockStaffSupport(page: Page, initialMode: "BOT_ACTIVE" | "STAFF_ACTIVE") {
  let conversation = supportConversation(initialMode);
  const unhandled: string[] = [];

  await page.route("**/api/backend/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (path === "/api/backend/auth/me" && request.method() === "GET") {
      await json(route, { profile: staffProfile });
      return;
    }
    if (path === "/api/backend/notifications" && request.method() === "GET") {
      await json(route, { notifications: [] });
      return;
    }
    if (path === "/api/backend/notifications/unread-count" && request.method() === "GET") {
      await json(route, { unreadCount: 0 });
      return;
    }
    if (path === "/api/backend/realtime/events" && request.method() === "GET") {
      await route.fulfill({ status: 200, contentType: "text/event-stream", body: "" });
      return;
    }
    if (path === "/api/backend/conversations" && request.method() === "GET") {
      await json(route, { conversations: [conversation] });
      return;
    }
    if (path === `/api/backend/conversations/${conversationId}/messages` && request.method() === "GET") {
      await json(route, { messages: conversation.messages, nextCursor: null, typingUsers: [] });
      return;
    }
    if (path === `/api/backend/conversations/${conversationId}/typing` && request.method() === "PATCH") {
      await json(route, { typingUsers: [] });
      return;
    }
    if (path === `/api/backend/conversations/${conversationId}/takeover` && request.method() === "POST") {
      conversation = {
        ...conversation,
        assignedStaffId: staffId,
        assignedStaff: {
          id: staffId,
          fullName: staffProfile.fullName,
          email: staffProfile.email
        },
        mode: "STAFF_ACTIVE",
        acceptedAt: "2026-08-21T08:02:00.000Z",
        updatedAt: "2026-08-21T08:02:00.000Z"
      };
      await json(route, { conversation });
      return;
    }

    unhandled.push(`${request.method()} ${path}`);
    await json(route, { error: "Unexpected API request in Staff takeover test." }, 500);
  });

  return unhandled;
}

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
  { name: "mobile-keyboard", width: 390, height: 430 }
] as const;

for (const viewport of viewports) {
  test(`handler status, takeover, and composer remain usable on ${viewport.name}`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Explicit viewport matrix runs once.");
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const unhandled = await mockStaffSupport(page, "STAFF_ACTIVE");

    await page.goto("/staff/messages");
    await dismissWelcomeGate(page);
    await page.getByRole("button", { name: /Mobile QA Student/ }).click();

    const thread = page.getByTestId("staff-conversation-thread");
    const composer = page.getByLabel("Reply to student");
    await expect(thread).toBeVisible();
    await expect(page.getByText("Handled by: Other Staff.", { exact: true })).toBeVisible();
    await expect(page.locator("#staff-composer-status")).toHaveText("Handled by: Other Staff. Take over ownership before replying.");
    await expect(composer).toBeDisabled();
    await page.getByRole("button", { name: "Take Over", exact: true }).click();
    const confirmation = page.getByRole("alertdialog", { name: "Take over this conversation?" });
    await expect(confirmation).toBeVisible();
    await expect(confirmation).toContainText("Other Staff");
    await expect(confirmation.getByRole("button", { name: "Cancel" })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await confirmation.getByRole("button", { name: "Take over", exact: true }).click();

    await expect(page.locator("#staff-composer-status")).toHaveText("You are the current handler: QA Staff.");
    await expect(composer).toBeEnabled();
    await composer.focus();

    const composerBox = await composer.boundingBox();
    expect(composerBox).not.toBeNull();
    expect((composerBox?.y ?? 0) + (composerBox?.height ?? 0)).toBeLessThanOrEqual(viewport.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    expect(unhandled).toEqual([]);
  });
}

test("Staff can take over a bot-active conversation before the student requests a handoff", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Behavior runs once; responsive coverage is separate.");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const unhandled = await mockStaffSupport(page, "BOT_ACTIVE");

  await page.goto("/staff/messages");
  await dismissWelcomeGate(page);
  await page.getByRole("button", { name: /Mobile QA Student/ }).click();

  await expect(page.getByText("Handled by: WesBot.", { exact: false })).toBeVisible();
  await expect(page.getByLabel("Reply to student")).toBeDisabled();
  await page.getByRole("button", { name: "Take Over", exact: true }).click();
  const confirmation = page.getByRole("alertdialog", { name: "Take over this conversation?" });
  await expect(confirmation).toContainText("WesBot will pause");
  await confirmation.getByRole("button", { name: "Take over", exact: true }).click();
  await expect(page.locator("#staff-composer-status")).toHaveText("You are the current handler: QA Staff.");
  await expect(page.getByLabel("Reply to student")).toBeEnabled();
  expect(unhandled).toEqual([]);
});
