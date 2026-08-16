import { expect, test, type Route } from "@playwright/test";
import type {
  BackendAuthProfile,
  BackendConversation,
  BackendConversationMessage
} from "../lib/api";
import { dismissWelcomeGate } from "./helpers";

const staffId = "00000000-0000-4000-8000-000000000011";
const studentId = "00000000-0000-4000-8000-000000000012";
const conversationId = "00000000-0000-4000-8000-000000000013";

const staffProfile: BackendAuthProfile = {
  id: staffId,
  role: "STAFF",
  studentNumber: null,
  fullName: "Commissary Staff",
  email: "staff@wesleyan.edu.ph",
  phone: null,
  department: "Commissary",
  address: null,
  avatarUrl: null
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body)
  });
}

function initialConversation(): BackendConversation {
  return {
    id: conversationId,
    studentId,
    assignedStaffId: staffId,
    subject: "Uniform stock question",
    status: "OPEN",
    mode: "STAFF_ACTIVE",
    category: "PRODUCT_AVAILABILITY",
    priority: 1,
    createdAt: "2026-08-16T08:00:00.000Z",
    updatedAt: "2026-08-16T08:01:00.000Z",
    student: {
      id: studentId,
      fullName: "Juan Dela Cruz",
      email: "juan.delacruz@wesleyan.edu.ph",
      studentNumber: "2026-0001"
    },
    assignedStaff: {
      id: staffId,
      fullName: staffProfile.fullName,
      email: staffProfile.email
    },
    messages: [
      {
        id: "00000000-0000-4000-8000-000000000014",
        conversationId,
        senderId: studentId,
        senderType: "STUDENT",
        message: "May available pa bang PE shirt?",
        createdAt: "2026-08-16T08:01:00.000Z",
        sender: {
          id: studentId,
          fullName: "Juan Dela Cruz",
          email: "juan.delacruz@wesleyan.edu.ph",
          studentNumber: "2026-0001"
        }
      }
    ],
    typingUsers: []
  };
}

test("staff send and resolve actions show immediate progress instead of appearing frozen", async ({ page }) => {
  let conversation = initialConversation();
  const unhandledApiPaths: string[] = [];

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

    if (path === "/api/backend/conversations" && request.method() === "GET") {
      await json(route, { conversations: [conversation] });
      return;
    }

    if (path === `/api/backend/conversations/${conversationId}/typing` && request.method() === "PATCH") {
      await json(route, { typingUsers: [] });
      return;
    }

    if (path === `/api/backend/conversations/${conversationId}/messages` && request.method() === "POST") {
      const payload = request.postDataJSON() as { message: string };
      await new Promise((resolve) => setTimeout(resolve, 900));
      const message: BackendConversationMessage = {
        id: "00000000-0000-4000-8000-000000000015",
        conversationId,
        senderId: staffId,
        senderType: "STAFF",
        message: payload.message,
        createdAt: "2026-08-16T08:02:00.000Z",
        sender: {
          id: staffId,
          fullName: staffProfile.fullName,
          email: staffProfile.email
        }
      };
      conversation = {
        ...conversation,
        messages: [...conversation.messages, message],
        updatedAt: message.createdAt
      };
      await json(route, { message, botMessage: null, conversation });
      return;
    }

    if (path === `/api/backend/conversations/${conversationId}/status` && request.method() === "PATCH") {
      await new Promise((resolve) => setTimeout(resolve, 900));
      conversation = {
        ...conversation,
        status: "RESOLVED",
        mode: "RESOLVED",
        resolvedAt: "2026-08-16T08:03:00.000Z",
        updatedAt: "2026-08-16T08:03:00.000Z"
      };
      await json(route, { conversation });
      return;
    }

    unhandledApiPaths.push(`${request.method()} ${path}`);
    await json(route, { error: "Unexpected API request in staff message loading test." }, 500);
  });

  await page.goto("/staff/messages");
  await dismissWelcomeGate(page);

  await expect(page.getByRole("heading", { name: "Message center" })).toBeVisible();
  await page.getByRole("button", { name: /Juan Dela Cruz/ }).click();

  const replyInput = page.getByLabel("Reply to student");
  await replyInput.fill("Available pa. I can reserve one for you.");
  await page.getByRole("button", { name: "Send reply" }).click();

  const sendingButton = page.getByRole("button", { name: "Sending reply" });
  await expect(sendingButton).toBeDisabled();
  await expect(sendingButton).toHaveAttribute("aria-busy", "true");
  await expect(replyInput).toBeDisabled();
  await expect(page.getByRole("status").filter({ hasText: "Sending reply to student" })).toBeVisible();

  const activeThread = replyInput.locator("xpath=ancestor::section[1]");
  await expect(activeThread.getByText("Available pa. I can reserve one for you.", { exact: true })).toBeVisible();
  await expect(page.getByText("Reply sent to student.", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Resolve", exact: true }).click();
  const resolvingButton = page.getByRole("button", { name: "Resolving..." });
  await expect(resolvingButton).toBeDisabled();
  await expect(resolvingButton).toHaveAttribute("aria-busy", "true");
  await expect(page.getByRole("status").filter({ hasText: "Resolving conversation" })).toBeVisible();

  await expect(page.getByRole("button", { name: "Reopen", exact: true })).toBeVisible();
  await expect(page.getByText("Uniform stock question marked as resolved.", { exact: true })).toBeVisible();
  expect(unhandledApiPaths).toEqual([]);
});
