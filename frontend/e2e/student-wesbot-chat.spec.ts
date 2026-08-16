import { expect, test, type Route } from "@playwright/test";
import type { BackendConversation } from "../lib/api";
import { dismissWelcomeGate } from "./helpers";

const studentId = "00000000-0000-4000-8000-000000000001";
const conversationId = "00000000-0000-4000-8000-000000000002";
const createdAt = "2026-08-14T15:00:00.000Z";

function conversation(mode: BackendConversation["mode"]): BackendConversation {
  return {
    id: conversationId,
    studentId,
    assignedStaffId: null,
    subject: "Available ba ang WESCOMM PE shirt?",
    status: "OPEN",
    mode,
    category: "PRODUCT",
    priority: mode === "WAITING_FOR_STAFF" ? 1 : 0,
    escalationReason: mode === "WAITING_FOR_STAFF" ? "Student requested a real staff member from the chat." : null,
    escalatedAt: mode === "WAITING_FOR_STAFF" ? "2026-08-14T15:02:00.000Z" : null,
    acceptedAt: null,
    resolvedAt: null,
    botSummary: null,
    lastIntent: "PRODUCT_AVAILABILITY",
    botReplyCount: 1,
    createdAt,
    updatedAt: mode === "WAITING_FOR_STAFF" ? "2026-08-14T15:02:00.000Z" : createdAt,
    student: {
      id: studentId,
      fullName: "QA Student",
      email: "student@wesleyan.edu.ph"
    },
    assignedStaff: null,
    typingUsers: [],
    messages: [
      {
        id: "00000000-0000-4000-8000-000000000003",
        conversationId,
        senderId: studentId,
        senderType: "STUDENT",
        message: "Available ba ang WESCOMM PE shirt?",
        createdAt
      },
      {
        id: "00000000-0000-4000-8000-000000000004",
        conversationId,
        senderId: null,
        senderType: "BOT",
        message: "Yes. The WESCOMM PE shirt is currently available with 12 units in stock.",
        createdAt: "2026-08-14T15:00:01.000Z"
      },
      ...(mode === "WAITING_FOR_STAFF" ? [{
        id: "00000000-0000-4000-8000-000000000005",
        conversationId,
        senderId: null,
        senderType: "SYSTEM" as const,
        message: "Your conversation is now in the Commissary Staff queue. WesBot automatic replies are paused.",
        createdAt: "2026-08-14T15:02:00.000Z"
      }] : [])
    ]
  };
}

test("WesBot opens as one messenger thread and hands the same chat to staff", async ({ page }, testInfo) => {
  const unhandledApiPaths: string[] = [];
  let conversations: BackendConversation[] = [];
  let firstMessagePayload: { subject?: string; message?: string } | null = null;
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body)
  });

  await page.route("**/api/backend/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (path === "/api/backend/auth/me") {
      await json(route, {
        profile: {
          id: studentId,
          role: "STUDENT",
          studentNumber: "QA-001",
          fullName: "QA Student",
          email: "student@wesleyan.edu.ph",
          phone: null,
          department: null,
          address: null,
          avatarUrl: null
        }
      });
      return;
    }
    if (path === "/api/backend/conversations" && request.method() === "GET") {
      await json(route, { conversations });
      return;
    }
    if (path === "/api/backend/conversations" && request.method() === "POST") {
      firstMessagePayload = request.postDataJSON() as { subject?: string; message?: string };
      conversations = [conversation("BOT_ACTIVE")];
      await json(route, { conversation: conversations[0] }, 201);
      return;
    }
    if (path === `/api/backend/conversations/${conversationId}/handoff` && request.method() === "POST") {
      conversations = [conversation("WAITING_FOR_STAFF")];
      await json(route, { conversation: conversations[0] });
      return;
    }
    if (path === `/api/backend/conversations/${conversationId}/typing` && request.method() === "PATCH") {
      await json(route, { typingUsers: [] });
      return;
    }
    if (path === "/api/backend/restrictions/me") {
      await json(route, {
        restrictionSummary: {
          activeRestriction: null,
          consecutiveOffenses: 0,
          offenses: [],
          policy: { firstRestrictionAt: 3 }
        }
      });
      return;
    }
    if (path === "/api/backend/notifications") {
      await json(route, { notifications: [] });
      return;
    }
    if (path === "/api/backend/push/public-key") {
      await json(route, { enabled: false, publicKey: "" });
      return;
    }

    unhandledApiPaths.push(`${request.method()} ${path}`);
    await json(route, { error: "Unexpected API request in WesBot chat test." }, 500);
  });

  await page.goto("/student/support");
  await dismissWelcomeGate(page);

  await expect(page.getByRole("heading", { name: "Chat with WesBot" })).toBeVisible();
  await expect(page.getByTestId("conversation-header").locator('img[src="/assets/chat-with-wesbot.svg"]')).toBeVisible();
  await expect(page.getByText("Automated assistant · Online", { exact: true })).toBeVisible();
  await expect(page.getByText("Hi! I'm WesBot.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Product availability" })).toBeVisible();
  await expect(page.getByRole("log")).toHaveCount(1);
  await expect(page.getByLabel("Message WesBot or commissary staff")).toHaveCount(1);
  await expect(page.getByLabel("Topic")).toHaveCount(0);

  const composer = page.getByLabel("Message WesBot or commissary staff");
  await composer.fill("Available ba ang WESCOMM PE shirt?");
  await page.getByRole("button", { name: "Send message" }).click();

  await expect(page.getByRole("log").getByText("Yes. The WESCOMM PE shirt is currently available with 12 units in stock.")).toBeVisible();
  expect(firstMessagePayload).toEqual({
    subject: "Available ba ang WESCOMM PE shirt?",
    message: "Available ba ang WESCOMM PE shirt?"
  });

  await page.getByRole("button", { name: "Talk to a real staff member" }).click();
  await expect(page.getByRole("log").getByText("Your conversation is now in the Commissary Staff queue. WesBot automatic replies are paused.")).toBeVisible();
  await expect(page.getByText("Waiting for commissary staff. You can keep adding details here.")).toBeVisible();
  await expect(page.getByLabel("Message WesBot or commissary staff")).toBeVisible();
  await expect(page.getByRole("log")).toHaveCount(1);

  if (testInfo.project.name === "mobile-chromium") {
    await page.getByRole("button", { name: "Open chat history" }).click();
    await expect(page.getByText("Messages", { exact: true })).toBeVisible();
    await page.locator("aside button").filter({ hasText: "Available ba ang WESCOMM PE shirt?" }).click();
    await expect(page.getByRole("log")).toBeVisible();
  }

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(unhandledApiPaths).toEqual([]);
});
