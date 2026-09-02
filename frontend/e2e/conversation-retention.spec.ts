import { expect, test, type Page, type Route } from "@playwright/test";
import type {
  BackendAuthProfile,
  BackendConversation,
  BackendConversationPurgePreview
} from "../lib/api";
import { authorizeMockedWorkspace, dismissWelcomeGate } from "./helpers";

const adminId = "95000000-0000-4000-8000-000000000001";
const staffId = "95000000-0000-4000-8000-000000000002";
const studentId = "95000000-0000-4000-8000-000000000003";
const conversationId = "95000000-0000-4000-8000-000000000031";
const messageId = "95000000-0000-4000-8000-000000000032";
const previewFingerprint = "b".repeat(64);
const confirmationPhrase = "PURGE 00000031";

const adminProfile: BackendAuthProfile = {
  id: adminId,
  role: "ADMIN",
  studentNumber: null,
  fullName: "Release QA Admin",
  email: "release.admin@wesleyan.edu.ph",
  phone: null,
  department: "Commissary",
  address: null,
  avatarUrl: null
};

const staffProfile: BackendAuthProfile = {
  ...adminProfile,
  id: staffId,
  role: "STAFF",
  fullName: "Release QA Staff",
  email: "release.staff@wesleyan.edu.ph"
};

function archivedConversation(): BackendConversation {
  return {
    id: conversationId,
    studentId,
    assignedStaffId: staffId,
    subject: "Retention acceptance evidence",
    status: "RESOLVED",
    mode: "RESOLVED",
    category: "GENERAL",
    priority: 0,
    escalationReason: null,
    escalatedAt: null,
    acceptedAt: "2026-05-01T01:00:00.000Z",
    resolvedAt: "2026-05-01T02:00:00.000Z",
    botSummary: null,
    lastIntent: null,
    botReplyCount: 0,
    studentArchivedAt: null,
    operationsArchivedAt: "2026-05-01T03:00:00.000Z",
    deletedAt: null,
    deletedById: null,
    purgeEligibleAt: null,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T03:00:00.000Z",
    student: {
      id: studentId,
      fullName: "Retention QA Student",
      email: "retention.student@wesleyan.edu.ph",
      studentNumber: "2026-0031"
    },
    assignedStaff: {
      id: staffId,
      fullName: staffProfile.fullName,
      email: staffProfile.email,
      studentNumber: null
    },
    messages: [{
      id: messageId,
      conversationId,
      senderId: studentId,
      senderType: "STUDENT",
      message: "Please retain this support evidence until the policy allows purge.",
      editedAt: null,
      editVersion: 0,
      createdAt: "2026-05-01T00:01:00.000Z",
      sender: {
        id: studentId,
        fullName: "Retention QA Student",
        email: "retention.student@wesleyan.edu.ph",
        studentNumber: "2026-0031"
      }
    }],
    typingUsers: []
  };
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function handleShellRequest(route: Route, profile: BackendAuthProfile) {
  const request = route.request();
  const path = new URL(request.url()).pathname;
  if (path === "/api/backend/auth/me" && request.method() === "GET") {
    await json(route, { profile });
    return true;
  }
  if (path === "/api/backend/notifications" && request.method() === "GET") {
    await json(route, { notifications: [], nextCursor: null });
    return true;
  }
  if (path === "/api/backend/notifications/unread-count" && request.method() === "GET") {
    await json(route, { unreadCount: 0 });
    return true;
  }
  if (path === "/api/backend/realtime/events" && request.method() === "GET") {
    await route.fulfill({ status: 200, contentType: "text/event-stream", body: "" });
    return true;
  }
  return false;
}

test("Admin completes archive to retention, restore, and exact-confirmation purge", async ({ page }) => {
  await authorizeMockedWorkspace(page, "ADMIN");
  let conversation = archivedConversation();
  let purged = false;
  const deletionPayloads: Array<{ deleted: boolean }> = [];
  const purgePayloads: Array<{
    confirmationPhrase: string;
    previewFingerprint: string;
    idempotencyKey: string;
  }> = [];
  const unhandled: string[] = [];

  await page.route("**/api/backend/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (await handleShellRequest(route, adminProfile)) return;

    if (path === "/api/backend/conversations" && request.method() === "GET") {
      const view = url.searchParams.get("view") ?? "ACTIVE";
      const visible = !purged && (
        (view === "ARCHIVED" && !conversation.deletedAt)
        || (view === "DELETED" && Boolean(conversation.deletedAt))
      );
      return json(route, { conversations: visible ? [conversation] : [] });
    }
    if (path === `/api/backend/conversations/${conversationId}/messages` && request.method() === "GET") {
      return json(route, { messages: conversation.messages, nextCursor: null, typingUsers: [] });
    }
    if (path === `/api/backend/conversations/${conversationId}/typing` && request.method() === "PATCH") {
      return json(route, { typingUsers: [] });
    }
    if (path === `/api/backend/conversations/${conversationId}/deletion` && request.method() === "PATCH") {
      const payload = request.postDataJSON() as { deleted: boolean };
      deletionPayloads.push(payload);
      conversation = payload.deleted
        ? {
            ...conversation,
            deletedAt: "2026-05-02T00:00:00.000Z",
            deletedById: adminId,
            purgeEligibleAt: "2026-07-31T00:00:00.000Z",
            updatedAt: "2026-05-02T00:00:00.000Z"
          }
        : {
            ...conversation,
            deletedAt: null,
            deletedById: null,
            purgeEligibleAt: null,
            updatedAt: "2026-05-02T01:00:00.000Z"
          };
      return json(route, { conversation });
    }
    if (path === `/api/backend/conversations/${conversationId}/purge-preview` && request.method() === "GET") {
      const preview: BackendConversationPurgePreview = {
        conversationId,
        retentionDays: 90,
        deletedAt: conversation.deletedAt!,
        purgeEligibleAt: conversation.purgeEligibleAt!,
        eligible: true,
        messageCount: 1,
        revisionCount: 0,
        confirmationPhrase,
        previewFingerprint
      };
      return json(route, { preview });
    }
    if (path === `/api/backend/conversations/${conversationId}/permanent` && request.method() === "DELETE") {
      purgePayloads.push(request.postDataJSON());
      purged = true;
      return json(route, {
        purge: {
          conversationId,
          messageCount: 1,
          revisionCount: 0,
          softDeletedAt: conversation.deletedAt,
          purgeEligibleAt: conversation.purgeEligibleAt,
          purgedAt: "2026-09-01T00:00:00.000Z",
          idempotentReplay: false
        }
      });
    }

    unhandled.push(`${request.method()} ${path}`);
    return json(route, { error: "Unexpected API request in retention release test." }, 500);
  });

  await page.goto("/admin/messages");
  await dismissWelcomeGate(page);
  await page.getByRole("button", { name: "Archived", exact: true }).click();
  await expect(page.getByText(conversation.subject, { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Delete", exact: true }).click();
  let confirmation = page.getByRole("alertdialog", { name: "Move this conversation into retention?" });
  await expect(confirmation).toContainText("recoverable by Admin for 90 days");
  await confirmation.getByRole("button", { name: "Move to Deleted" }).click();
  await expect(page.getByText("Conversation moved into 90-day retention.")).toBeVisible();

  await page.getByRole("button", { name: "Deleted", exact: true }).click();
  await expect(page.getByText("Retention copy — read only.", { exact: false })).toBeVisible();
  await expect(page.getByLabel("Reply to student")).toBeDisabled();
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  confirmation = page.getByRole("alertdialog", { name: "Restore this conversation?" });
  await confirmation.getByRole("button", { name: "Restore conversation" }).click();
  await expect(page.getByText("Conversation restored to the operations archive.")).toBeVisible();

  await page.getByRole("button", { name: "Archived", exact: true }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("alertdialog", { name: "Move this conversation into retention?" })
    .getByRole("button", { name: "Move to Deleted" }).click();
  await page.getByRole("button", { name: "Deleted", exact: true }).click();
  await page.getByRole("button", { name: "Permanently Purge", exact: true }).click();

  const purgeDialog = page.getByRole("alertdialog", { name: "Permanently purge this evidence?" });
  await expect(purgeDialog).toContainText("minimal audit tombstone");
  const purgeButton = purgeDialog.getByRole("button", { name: "Permanently Purge" });
  await expect(purgeButton).toBeDisabled();
  await purgeDialog.getByLabel("Confirmation phrase").fill(confirmationPhrase);
  await expect(purgeButton).toBeEnabled();
  await purgeButton.click();

  await expect(page.getByText(/Conversation evidence permanently purged/)).toBeVisible();
  expect(deletionPayloads).toEqual([{ deleted: true }, { deleted: false }, { deleted: true }]);
  expect(purgePayloads).toHaveLength(1);
  expect(purgePayloads[0]?.confirmationPhrase).toBe(confirmationPhrase);
  expect(purgePayloads[0]?.previewFingerprint).toBe(previewFingerprint);
  expect(purgePayloads[0]?.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/i);
  expect(unhandled).toEqual([]);
});

test("Staff workspace does not expose the Admin Deleted retention view", async ({ page }) => {
  await authorizeMockedWorkspace(page, "STAFF");
  const unhandled: string[] = [];
  await page.route("**/api/backend/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (await handleShellRequest(route, staffProfile)) return;
    if (path === "/api/backend/conversations" && request.method() === "GET") {
      return json(route, { conversations: [] });
    }
    unhandled.push(`${request.method()} ${path}`);
    return json(route, { error: "Unexpected API request in Staff retention test." }, 500);
  });

  await page.goto("/staff/messages");
  await dismissWelcomeGate(page);
  await expect(page.getByRole("button", { name: "Active", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Archived", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Deleted", exact: true })).toHaveCount(0);
  expect(unhandled).toEqual([]);
});
