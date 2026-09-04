import { expect, test, type Route } from "@playwright/test";
import type { BackendConversation } from "../lib/api";
import { dismissWelcomeGate } from "./helpers";

const studentId = "00000000-0000-4000-8000-000000000001";
const conversationId = "00000000-0000-4000-8000-000000000002";
const staffId = "00000000-0000-4000-8000-000000000006";
const createdAt = "2026-08-14T15:00:00.000Z";

function conversation(mode: BackendConversation["mode"]): BackendConversation {
  return {
    id: conversationId,
    studentId,
    assignedStaffId: mode === "STAFF_ACTIVE" ? staffId : null,
    subject: "Available ba ang WESCOMM PE shirt?",
    status: "OPEN",
    mode,
    category: "PRODUCT",
    priority: mode === "WAITING_FOR_STAFF" ? 1 : 0,
    escalationReason: mode === "WAITING_FOR_STAFF" ? "Student requested a real staff member from the chat." : null,
    escalatedAt: mode === "WAITING_FOR_STAFF" ? "2026-08-14T15:02:00.000Z" : null,
    acceptedAt: mode === "STAFF_ACTIVE" ? "2026-08-14T15:03:00.000Z" : null,
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
    assignedStaff: mode === "STAFF_ACTIVE" ? {
      id: staffId,
      fullName: "Maria Santos",
      email: "maria.santos@wesleyan.edu.ph"
    } : null,
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
    if (path === `/api/backend/conversations/${conversationId}/messages` && request.method() === "GET") {
      await json(route, { messages: conversations[0]?.messages ?? [], nextCursor: null, typingUsers: [] });
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
    if (path === "/api/backend/notifications/unread-count") {
      await json(route, { unreadCount: 0 });
      return;
    }
    if (path === "/api/backend/realtime/events") {
      await route.fulfill({ status: 200, contentType: "text/event-stream", body: "" });
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

  conversations = [conversation("STAFF_ACTIVE")];
  await page.getByTestId("conversation-header").getByRole("button", { name: "Refresh conversations" }).click();
  await expect(page.getByText("Handled by: Maria Santos. WesBot replies are paused.", { exact: true })).toBeVisible();

  if (testInfo.project.name === "desktop-chromium") {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 768, height: 1024 },
      { width: 390, height: 844 },
      { width: 390, height: 430 }
    ]) {
      await page.setViewportSize(viewport);
      const composerBox = await page.getByLabel("Message WesBot or commissary staff").boundingBox();
      expect(composerBox).not.toBeNull();
      expect((composerBox?.y ?? 0) + (composerBox?.height ?? 0)).toBeLessThanOrEqual(viewport.height);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    }
  }

  if (testInfo.project.name === "mobile-chromium") {
    await page.getByRole("button", { name: "Open chat history" }).click();
    await expect(page.getByText("Messages", { exact: true })).toBeVisible();
    await page.locator("aside button").filter({ hasText: "Available ba ang WESCOMM PE shirt?" }).click();
    await expect(page.getByRole("log")).toBeVisible();
  }

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(unhandledApiPaths).toEqual([]);
});

test("student chat has truthful archive states and Messenger-style conversation and message actions", async ({ page }, testInfo) => {
  const unhandledApiPaths: string[] = [];
  const archiveRequests: boolean[] = [];
  const editRequests: Array<{ message: string; expectedEditVersion: number }> = [];
  let activeConversations: BackendConversation[] = [conversation("BOT_ACTIVE")];
  let archivedConversations: BackendConversation[] = [];
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body)
  });

  await page.route("**/api/backend/**", async (route) => {
    const request = route.request();
    const requestUrl = new URL(request.url());
    const path = requestUrl.pathname;

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
      await json(route, {
        conversations: requestUrl.searchParams.get("view") === "ARCHIVED"
          ? archivedConversations
          : activeConversations
      });
      return;
    }
    if (path === `/api/backend/conversations/${conversationId}/messages` && request.method() === "GET") {
      const current = [...activeConversations, ...archivedConversations].find((item) => item.id === conversationId);
      await json(route, { messages: current?.messages ?? [], nextCursor: null, typingUsers: [] });
      return;
    }
    if (path === `/api/backend/conversations/${conversationId}/messages/00000000-0000-4000-8000-000000000007` && request.method() === "PATCH") {
      const payload = request.postDataJSON() as { message: string; expectedEditVersion: number };
      editRequests.push(payload);
      const current = activeConversations[0];
      const updatedMessage = {
        ...current.messages.at(-1)!,
        message: payload.message,
        editedAt: new Date().toISOString(),
        editVersion: payload.expectedEditVersion + 1
      };
      activeConversations = [{
        ...current,
        messages: current.messages.map((message) => message.id === updatedMessage.id ? updatedMessage : message)
      }];
      await json(route, { message: updatedMessage });
      return;
    }
    if (path === `/api/backend/conversations/${conversationId}/archive` && request.method() === "PATCH") {
      const { archived } = request.postDataJSON() as { archived: boolean };
      archiveRequests.push(archived);
      if (archived) {
        const current = activeConversations[0];
        const updated = { ...current, studentArchivedAt: new Date().toISOString() };
        activeConversations = [];
        archivedConversations = [updated];
        await json(route, { conversation: updated });
      } else {
        const current = archivedConversations[0];
        const updated = { ...current, studentArchivedAt: null };
        archivedConversations = [];
        activeConversations = [updated];
        await json(route, { conversation: updated });
      }
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
    if (path === "/api/backend/notifications/unread-count") {
      await json(route, { unreadCount: 0 });
      return;
    }
    if (path === "/api/backend/realtime/events") {
      await route.fulfill({ status: 200, contentType: "text/event-stream", body: "" });
      return;
    }
    if (path === "/api/backend/push/public-key") {
      await json(route, { enabled: false, publicKey: "" });
      return;
    }

    unhandledApiPaths.push(`${request.method()} ${path}`);
    await json(route, { error: "Unexpected API request in student archive actions test." }, 500);
  });

  const longPress = async (locator: ReturnType<typeof page.locator>) => {
    await locator.dispatchEvent("pointerdown", { pointerId: 1, pointerType: "touch", button: 0, clientX: 20, clientY: 20 });
    await page.waitForTimeout(550);
    await locator.dispatchEvent("pointerup", { pointerId: 1, pointerType: "touch", button: 0, clientX: 20, clientY: 20 });
  };

  await page.goto("/student/support");
  await dismissWelcomeGate(page);

  if (testInfo.project.name === "mobile-chromium") {
    await page.getByRole("button", { name: "Open chat history" }).click();
  }
  await page.getByRole("button", { name: "Archived", exact: true }).click();
  await expect(page.getByRole("heading", { name: "No archived chats yet" })).toBeVisible();
  await expect(page.getByText("Hi! I'm WesBot.", { exact: false })).toHaveCount(0);
  await expect(page.getByLabel("Message WesBot or commissary staff")).toHaveCount(0);

  if (testInfo.project.name === "mobile-chromium") {
    await page.getByRole("button", { name: "Open chat history" }).click();
  }
  await page.getByRole("button", { name: "Active", exact: true }).click();
  await expect(page.getByRole("log").getByText("Yes. The WESCOMM PE shirt is currently available with 12 units in stock.")).toBeVisible();

  const firstOwnBubble = page.getByRole("log").getByText("Available ba ang WESCOMM PE shirt?", { exact: true }).locator("..");
  await longPress(firstOwnBubble);
  const messageActions = page.getByRole("dialog", { name: "Message actions" });
  await expect(messageActions).toBeVisible();
  await messageActions.getByRole("button", { name: "Edit and resend" }).click();
  await expect(page.getByText("Editing a copy. Sending will create a new follow-up message.")).toBeVisible();
  await expect(page.getByLabel("Message WesBot or commissary staff")).toHaveValue("Available ba ang WESCOMM PE shirt?");
  await page.getByRole("button", { name: "Cancel edit and resend" }).click();

  const editableCreatedAt = new Date().toISOString();
  const editable = conversation("WAITING_FOR_STAFF");
  activeConversations = [{
    ...editable,
    updatedAt: editableCreatedAt,
    messages: [...editable.messages, {
      id: "00000000-0000-4000-8000-000000000007",
      conversationId,
      senderId: studentId,
      senderType: "STUDENT",
      message: "Latest editable message",
      editVersion: 0,
      createdAt: editableCreatedAt
    }]
  }];
  await page.getByRole("button", { name: "Refresh conversations" }).click();
  const editableBubble = page.getByRole("log").getByText("Latest editable message", { exact: true }).locator("..");
  await expect(editableBubble).toBeVisible();
  await longPress(editableBubble);
  await page.getByRole("dialog", { name: "Message actions" }).getByRole("button", { name: "Edit message" }).click();
  await page.getByLabel("Edit message").fill("Updated editable message");
  await page.getByRole("button", { name: "Save edited message" }).click();
  await expect(page.getByRole("log").getByText("Updated editable message", { exact: true })).toBeVisible();
  await expect(page.getByRole("log").getByText("Edited", { exact: true })).toBeVisible();
  expect(editRequests).toEqual([{ message: "Updated editable message", expectedEditVersion: 0 }]);

  if (testInfo.project.name === "mobile-chromium") {
    await page.getByRole("button", { name: "Open chat history" }).click();
  }
  const conversationButton = page.locator('aside button[aria-current="true"]');
  await longPress(conversationButton);
  await page.getByRole("dialog", { name: "Conversation actions" }).getByRole("button", { name: "Archive chat" }).click();
  await expect(page.getByText("Chat archived.")).toBeVisible();
  expect(archiveRequests).toEqual([true]);

  await page.getByRole("button", { name: "Archived", exact: true }).click();
  await expect(page.getByText("This chat is archived. Restore it before sending another message.")).toBeVisible();
  await expect(page.getByLabel("Message WesBot or commissary staff")).toHaveCount(0);
  await page.getByRole("button", { name: "Open conversation actions" }).click();
  await page.getByRole("dialog", { name: "Conversation actions" }).getByRole("button", { name: "Restore chat" }).click();
  if (testInfo.project.name === "mobile-chromium") {
    await expect(page.locator("aside").getByText("No archived chats yet", { exact: true })).toBeVisible();
  } else {
    await expect(page.getByRole("heading", { name: "No archived chats yet" })).toBeVisible();
  }
  expect(archiveRequests).toEqual([true, false]);
  expect(unhandledApiPaths).toEqual([]);
});
