import { env } from "../config/env.js";
import { createWesbotConcernKey, detectWesbotIntent } from "../domain/wesbot.js";
import { supabaseAdmin } from "../lib/supabase.js";
import {
  type AppRole,
  type ConversationMode,
  type ConversationStatus,
  type RawProfileSummary,
  mapProfileSummary
} from "../types/app.js";
import { decryptSensitiveText, encryptSensitiveText } from "../utils/field-encryption.js";
import { HttpError } from "../utils/http-error.js";
import { safelyRecordAuditLog } from "./audit-log.service.js";
import { createNotification, createNotificationsForRoles } from "./notification.service.js";
import { buildWesbotHandoffSummary, resolveWesbotReply } from "./wesbot.service.js";

const TYPING_TTL_MS = 6000;

type TypingUser = {
  userId: string;
  fullName: string;
  email: string;
  role: AppRole;
  updatedAt: string;
};

const typingState = new Map<string, Map<string, TypingUser>>();

type ConversationMessageSenderType = "STUDENT" | "BOT" | "STAFF" | "SYSTEM";

type RawConversationMessage = {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  sender_type: ConversationMessageSenderType;
  message: string;
  intent: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  sender?: RawProfileSummary | RawProfileSummary[] | null;
};

type RawConversation = {
  id: string;
  student_id: string;
  assigned_staff_id: string | null;
  subject: string;
  status: ConversationStatus;
  mode: ConversationMode;
  category: string | null;
  priority: number;
  escalation_reason: string | null;
  escalated_at: string | null;
  accepted_at: string | null;
  resolved_at: string | null;
  bot_summary: string | null;
  last_intent: string | null;
  last_concern_key: string | null;
  bot_reply_count: number;
  created_at: string;
  updated_at: string;
  student: RawProfileSummary | RawProfileSummary[] | null;
  assignedStaff: RawProfileSummary | RawProfileSummary[] | null;
  messages: RawConversationMessage[] | null;
};

const messageSelect = `
  id,
  conversation_id,
  sender_id,
  sender_type,
  message,
  intent,
  metadata,
  created_at,
  sender:profiles!conversation_messages_sender_id_fkey(id,full_name,email,student_number)
`;

const conversationBaseSelect = `
  id,
  student_id,
  assigned_staff_id,
  subject,
  status,
  mode,
  category,
  priority,
  escalation_reason,
  escalated_at,
  accepted_at,
  resolved_at,
  bot_summary,
  last_intent,
  last_concern_key,
  bot_reply_count,
  created_at,
  updated_at,
  student:profiles!conversations_student_id_fkey(id,full_name,email,student_number),
  assignedStaff:profiles!conversations_assigned_staff_id_fkey(id,full_name,email,student_number)
`;

const conversationListSelect = `
  ${conversationBaseSelect},
  messages:conversation_messages(${messageSelect})
`;

function safeMetadata(value: RawConversationMessage["metadata"]) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function mapMessage(row: RawConversationMessage) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    senderType: row.sender_type,
    message: decryptSensitiveText(row.message, "conversation.message") ?? "",
    intent: row.intent,
    metadata: safeMetadata(row.metadata),
    createdAt: row.created_at,
    sender: mapProfileSummary(row.sender)
  };
}

function pruneTypingState(conversationId?: string) {
  const now = Date.now();
  const conversationIds = conversationId ? [conversationId] : Array.from(typingState.keys());

  conversationIds.forEach((id) => {
    const users = typingState.get(id);
    if (!users) return;

    users.forEach((typingUser, userId) => {
      if (now - new Date(typingUser.updatedAt).getTime() > TYPING_TTL_MS) users.delete(userId);
    });

    if (!users.size) typingState.delete(id);
  });
}

function getTypingUsers(conversationId: string, viewerId?: string) {
  pruneTypingState(conversationId);
  return Array.from(typingState.get(conversationId)?.values() ?? []).filter((typingUser) => typingUser.userId !== viewerId);
}

function clearTypingUser(conversationId: string, userId: string) {
  const users = typingState.get(conversationId);
  if (!users) return;
  users.delete(userId);
  if (!users.size) typingState.delete(conversationId);
}

function mapConversation(row: RawConversation, viewerId?: string) {
  return {
    id: row.id,
    studentId: row.student_id,
    assignedStaffId: row.assigned_staff_id,
    subject: decryptSensitiveText(row.subject, "conversation.subject") ?? "Support request",
    status: row.status,
    mode: row.mode,
    category: row.category,
    priority: row.priority,
    escalationReason: row.escalation_reason,
    escalatedAt: row.escalated_at,
    acceptedAt: row.accepted_at,
    resolvedAt: row.resolved_at,
    botSummary: decryptSensitiveText(row.bot_summary, "conversation.bot_summary"),
    lastIntent: row.last_intent,
    lastConcernKey: row.last_concern_key,
    botReplyCount: row.bot_reply_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    student: mapProfileSummary(row.student),
    assignedStaff: mapProfileSummary(row.assignedStaff),
    messages: (row.messages ?? []).map(mapMessage).sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    typingUsers: getTypingUsers(row.id, viewerId)
  };
}

async function requireConversation(conversationId: string, viewerId?: string) {
  const { data, error } = await supabaseAdmin
    .from("conversations")
    .select(conversationBaseSelect)
    .eq("id", conversationId)
    .maybeSingle();

  if (error) throw HttpError.fromSupabase(error);
  if (!data) throw new HttpError(404, "Conversation not found.");
  return mapConversation(data as unknown as RawConversation, viewerId);
}

async function loadRecentConversationMessages(conversationId: string, limit = 50) {
  const { data, error } = await supabaseAdmin
    .from("conversation_messages")
    .select(messageSelect)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw HttpError.fromSupabase(error);
  return ((data ?? []) as unknown as RawConversationMessage[])
    .map(mapMessage)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function withMessages<T extends Awaited<ReturnType<typeof requireConversation>>>(
  conversation: T,
  messages: Awaited<ReturnType<typeof loadRecentConversationMessages>>
) {
  return { ...conversation, messages };
}

function assertConversationAccess(conversation: Awaited<ReturnType<typeof requireConversation>>, userId: string, role: AppRole) {
  if (role === "STUDENT" && conversation.studentId !== userId) {
    throw new HttpError(403, "You do not have access to this conversation.");
  }
}

async function insertConversationMessage(input: {
  conversationId: string;
  senderId?: string | null;
  senderType: ConversationMessageSenderType;
  message: string;
  intent?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const { data, error } = await supabaseAdmin
    .from("conversation_messages")
    .insert({
      conversation_id: input.conversationId,
      sender_id: input.senderId ?? null,
      sender_type: input.senderType,
      message: encryptSensitiveText(input.message.trim(), "conversation.message"),
      intent: input.intent ?? null,
      metadata: input.metadata ?? {}
    })
    .select(messageSelect)
    .single();

  if (error) throw HttpError.fromSupabase(error);
  return mapMessage(data as unknown as RawConversationMessage);
}

async function notifyStaffQueue(conversation: Awaited<ReturnType<typeof requireConversation>>) {
  await createNotificationsForRoles(["STAFF", "ADMIN"], {
    type: "MESSAGE",
    title: "Student waiting for Staff",
    message: `${conversation.student?.fullName || conversation.student?.email || "A student"} requested human support for ${conversation.subject}.`,
    actionUrl: `/staff/messages?conversationId=${encodeURIComponent(conversation.id)}`
  });
}

function handoffSummary(conversation: Awaited<ReturnType<typeof requireConversation>>, reason: string) {
  return buildWesbotHandoffSummary({
    subject: conversation.subject,
    intent: conversation.lastIntent,
    reason,
    studentMessages: conversation.messages
      .filter((message) => message.senderType === "STUDENT")
      .map((message) => message.message)
  });
}

async function moveConversationToStaffQueue(input: {
  conversation: Awaited<ReturnType<typeof requireConversation>>;
  reason: string;
  requestedById: string;
}) {
  if (input.conversation.mode === "WAITING_FOR_STAFF" || input.conversation.mode === "STAFF_ACTIVE") {
    return input.conversation;
  }

  const now = new Date().toISOString();
  const summary = handoffSummary(input.conversation, input.reason);
  const { data, error } = await supabaseAdmin
    .from("conversations")
    .update({
      status: "OPEN",
      mode: "WAITING_FOR_STAFF",
      assigned_staff_id: null,
      escalation_reason: input.reason.slice(0, 500),
      escalated_at: now,
      accepted_at: null,
      resolved_at: null,
      bot_summary: encryptSensitiveText(summary, "conversation.bot_summary"),
      priority: Math.max(1, input.conversation.priority),
      updated_at: now
    })
    .eq("id", input.conversation.id)
    .select(conversationBaseSelect)
    .single();

  if (error) throw HttpError.fromSupabase(error);
  const updated = mapConversation(data as unknown as RawConversation, input.requestedById);
  await notifyStaffQueue(updated);
  await safelyRecordAuditLog({
    actorId: input.requestedById,
    action: "SUPPORT_HANDOFF_REQUESTED",
    entityType: "conversation",
    entityId: input.conversation.id,
    summary: "Requested Commissary Staff assistance from WesBot.",
    metadata: { reason: input.reason.slice(0, 180), studentId: input.conversation.studentId }
  });
  return updated;
}

async function createBotReply(
  conversationId: string,
  studentId: string,
  userMessage: string,
  replyToMessageId?: string
) {
  const conversation = await requireConversation(conversationId, studentId);
  if (!env.WESBOT_ENABLED || conversation.mode !== "BOT_ACTIVE" || conversation.status === "RESOLVED") return null;

  const detectedIntent = detectWesbotIntent(userMessage);
  const candidateConcernKey = createWesbotConcernKey(detectedIntent, userMessage);
  const repeatCount = candidateConcernKey === conversation.lastConcernKey ? conversation.botReplyCount : 0;

  let reply;
  try {
    reply = await resolveWesbotReply({ studentId, message: userMessage, repeatCount });
  } catch (error) {
    const detail = error instanceof Error ? error.name : "unknown";
    console.warn(`WesBot grounded lookup failed; returning safe fallback (${detail}).`);
    reply = {
      message: "I’m unable to verify the current WESCOMM information right now. Please try again or choose Talk to Staff.",
      intent: detectedIntent,
      category: "GENERAL",
      concernKey: candidateConcernKey,
      sourceReferences: ["support:lookup-failed"],
      handoffRequested: false,
      staffRecommended: true,
      usedAi: false
    } as const;
  }

  const botMessage = await insertConversationMessage({
    conversationId,
    senderType: "BOT",
    message: reply.message,
    intent: reply.intent,
    metadata: {
      automated: true,
      ...(replyToMessageId ? { replyToMessageId } : {}),
      sources: reply.sourceReferences,
      staffRecommended: reply.staffRecommended,
      usedAi: reply.usedAi
    }
  });

  const nextCount = reply.concernKey === conversation.lastConcernKey ? conversation.botReplyCount + 1 : 1;
  const { error: updateError } = await supabaseAdmin
    .from("conversations")
    .update({
      category: reply.category,
      last_intent: reply.intent,
      last_concern_key: reply.concernKey,
      bot_reply_count: nextCount,
      updated_at: botMessage.createdAt
    })
    .eq("id", conversationId);
  if (updateError) throw HttpError.fromSupabase(updateError);

  if (reply.handoffRequested) {
    const refreshed = withMessages(
      await requireConversation(conversationId, studentId),
      await loadRecentConversationMessages(conversationId)
    );
    await moveConversationToStaffQueue({
      conversation: refreshed,
      reason: "Student explicitly requested a real Staff member.",
      requestedById: studentId
    });
  }

  return botMessage;
}

export async function createBotReplyForMessage(input: {
  conversationId: string;
  messageId: string;
  studentId: string;
}) {
  const conversation = await requireConversation(input.conversationId, input.studentId);
  assertConversationAccess(conversation, input.studentId, "STUDENT");

  const { data: existingData, error: existingError } = await supabaseAdmin
    .from("conversation_messages")
    .select(messageSelect)
    .eq("conversation_id", input.conversationId)
    .eq("sender_type", "BOT")
    .contains("metadata", { replyToMessageId: input.messageId })
    .limit(1)
    .maybeSingle();
  if (existingError) throw HttpError.fromSupabase(existingError);
  if (existingData) return mapMessage(existingData as unknown as RawConversationMessage);

  const { data: sourceData, error: sourceError } = await supabaseAdmin
    .from("conversation_messages")
    .select(messageSelect)
    .eq("id", input.messageId)
    .eq("conversation_id", input.conversationId)
    .eq("sender_id", input.studentId)
    .eq("sender_type", "STUDENT")
    .maybeSingle();
  if (sourceError) throw HttpError.fromSupabase(sourceError);
  if (!sourceData) throw new HttpError(404, "Student message not found.");
  const sourceMessage = mapMessage(sourceData as unknown as RawConversationMessage);
  return createBotReply(input.conversationId, input.studentId, sourceMessage.message, input.messageId);
}

export async function listConversations(userId: string, role: AppRole, limit = 50) {
  let query = supabaseAdmin
    .from("conversations")
    .select(conversationListSelect)
    .order("updated_at", { ascending: false })
    .order("created_at", { referencedTable: "conversation_messages", ascending: false })
    .limit(1, { referencedTable: "conversation_messages" })
    .limit(Math.min(Math.max(limit, 1), 50));
  if (role === "STUDENT") query = query.eq("student_id", userId);

  const { data, error } = await query;
  if (error) throw HttpError.fromSupabase(error);
  const conversations = ((data ?? []) as unknown as RawConversation[]).map((conversation) => mapConversation(conversation, userId));
  return role === "STUDENT" ? conversations.filter((conversation) => conversation.studentId === userId) : conversations;
}

export async function listConversationMessages(input: {
  conversationId: string;
  userId: string;
  role: AppRole;
  limit?: number;
  before?: string;
  after?: string;
}) {
  const conversation = await requireConversation(input.conversationId, input.userId);
  assertConversationAccess(conversation, input.userId, input.role);
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  let query = supabaseAdmin
    .from("conversation_messages")
    .select(messageSelect)
    .eq("conversation_id", input.conversationId)
    .order("created_at", { ascending: input.after ? true : false })
    .limit(limit + 1);

  if (input.before) query = query.lt("created_at", input.before);
  if (input.after) query = query.gt("created_at", input.after);

  const { data, error } = await query;
  if (error) throw HttpError.fromSupabase(error);
  const rows = (data ?? []) as unknown as RawConversationMessage[];
  const hasMore = rows.length > limit;
  const messages = rows.slice(0, limit).map(mapMessage).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  return {
    messages,
    nextCursor: !input.after && hasMore ? messages[0]?.createdAt ?? null : null,
    typingUsers: getTypingUsers(input.conversationId, input.userId)
  };
}

export async function createConversation(input: { studentId: string; subject: string; message: string }) {
  const mode: ConversationMode = env.WESBOT_ENABLED ? "BOT_ACTIVE" : "WAITING_FOR_STAFF";
  const { data: conversationData, error: conversationError } = await supabaseAdmin
    .from("conversations")
    .insert({
      student_id: input.studentId,
      subject: encryptSensitiveText(input.subject.trim(), "conversation.subject"),
      status: "OPEN",
      mode,
      escalation_reason: env.WESBOT_ENABLED ? null : "WesBot is disabled; routed directly to Staff.",
      escalated_at: env.WESBOT_ENABLED ? null : new Date().toISOString(),
      priority: env.WESBOT_ENABLED ? 0 : 1
    })
    .select("id")
    .single();
  if (conversationError) throw HttpError.fromSupabase(conversationError);

  const conversation = conversationData as { id: string };
  const message = await insertConversationMessage({
    conversationId: conversation.id,
    senderId: input.studentId,
    senderType: "STUDENT",
    message: input.message
  });

  if (!env.WESBOT_ENABLED) {
    const created = await requireConversation(conversation.id, input.studentId);
    await notifyStaffQueue(created);
  }

  return {
    conversation: withMessages(await requireConversation(conversation.id, input.studentId), [message]),
    message,
    botReplyPending: env.WESBOT_ENABLED
  };
}

export async function createMessage(input: {
  conversationId: string;
  senderId: string;
  senderRole: AppRole;
  message: string;
}) {
  let conversation = await requireConversation(input.conversationId, input.senderId);
  assertConversationAccess(conversation, input.senderId, input.senderRole);
  clearTypingUser(input.conversationId, input.senderId);

  const isStudent = input.senderRole === "STUDENT";
  const now = new Date().toISOString();

  if (conversation.status === "RESOLVED") {
    const mode: ConversationMode = isStudent
      ? (env.WESBOT_ENABLED ? "BOT_ACTIVE" : "WAITING_FOR_STAFF")
      : "STAFF_ACTIVE";
    const { error } = await supabaseAdmin
      .from("conversations")
      .update({
        status: "OPEN",
        mode,
        assigned_staff_id: isStudent ? null : input.senderId,
        resolved_at: null,
        accepted_at: isStudent ? null : now,
        updated_at: now
      })
      .eq("id", input.conversationId);
    if (error) throw HttpError.fromSupabase(error);
    conversation = await requireConversation(input.conversationId, input.senderId);
  }

  if (!isStudent && (conversation.mode !== "STAFF_ACTIVE" || conversation.assignedStaffId !== input.senderId)) {
    throw new HttpError(
      409,
      conversation.mode === "WAITING_FOR_STAFF"
        ? "Accept this conversation before replying."
        : "This conversation is not assigned to you.",
      conversation.mode === "WAITING_FOR_STAFF" ? "CONVERSATION_ACCEPT_REQUIRED" : "CONVERSATION_ALREADY_ASSIGNED"
    );
  }

  const message = await insertConversationMessage({
    conversationId: input.conversationId,
    senderId: input.senderId,
    senderType: isStudent ? "STUDENT" : "STAFF",
    message: input.message
  });

  const updates: Record<string, unknown> = { status: "OPEN", updated_at: message.createdAt };
  if (!isStudent) {
    updates.mode = "STAFF_ACTIVE";
    updates.assigned_staff_id = input.senderId;
    updates.accepted_at = conversation.acceptedAt ?? now;
  }
  const { error: updateError } = await supabaseAdmin.from("conversations").update(updates).eq("id", input.conversationId);
  if (updateError) throw HttpError.fromSupabase(updateError);

  let botMessage = null;
  let botReplyPending = false;
  if (isStudent) {
    if (conversation.mode === "BOT_ACTIVE" && env.WESBOT_ENABLED) {
      botReplyPending = true;
    } else {
      await createNotificationsForRoles(["STAFF", "ADMIN"], {
        type: "MESSAGE",
        title: conversation.mode === "WAITING_FOR_STAFF" ? "Student replied while waiting" : "Student replied to Staff",
        message: `${conversation.student?.fullName || conversation.student?.email || "A student"} sent a support reply.`,
        actionUrl: `/staff/messages?conversationId=${encodeURIComponent(conversation.id)}`
      });
    }
  } else {
    await createNotification({
      userId: conversation.studentId,
      type: "MESSAGE",
      title: "Staff replied",
      message: `Commissary Staff replied to ${conversation.subject}.`,
      actionUrl: `/student/support?conversationId=${encodeURIComponent(conversation.id)}`
    });
    await safelyRecordAuditLog({
      actorId: input.senderId,
      action: "SUPPORT_MESSAGE_SENT",
      entityType: "conversation",
      entityId: input.conversationId,
      summary: "Sent a Staff support reply.",
      metadata: { studentId: conversation.studentId }
    });
  }

  return {
    message,
    botMessage,
    botReplyPending,
    conversation: withMessages(
      await requireConversation(input.conversationId, input.senderId),
      [message, ...(botMessage ? [botMessage] : [])]
    )
  };
}

export async function requestStaffHandoff(input: { conversationId: string; studentId: string; reason?: string }) {
  const conversation = await requireConversation(input.conversationId, input.studentId);
  assertConversationAccess(conversation, input.studentId, "STUDENT");

  const updated = await moveConversationToStaffQueue({
    conversation,
    reason: input.reason?.trim() || "Student selected Talk to Staff.",
    requestedById: input.studentId
  });

  if (conversation.mode !== "WAITING_FOR_STAFF" && conversation.mode !== "STAFF_ACTIVE") {
    await insertConversationMessage({
      conversationId: input.conversationId,
      senderType: "SYSTEM",
      message: "Your conversation is now in the Commissary Staff queue. WesBot automatic replies are paused."
    });
  }
  return requireConversation(updated.id, input.studentId);
}

export async function acceptConversation(input: { conversationId: string; staffId: string }) {
  const conversation = await requireConversation(input.conversationId, input.staffId);
  if (conversation.status === "RESOLVED") throw new HttpError(409, "Reopen this conversation before accepting it.");
  if (conversation.mode === "STAFF_ACTIVE" && conversation.assignedStaffId === input.staffId) return conversation;
  if (conversation.mode === "STAFF_ACTIVE" && conversation.assignedStaffId !== input.staffId) {
    throw new HttpError(409, "Another Staff member is already handling this conversation.", "CONVERSATION_ALREADY_ASSIGNED");
  }
  if (conversation.mode !== "WAITING_FOR_STAFF") {
    throw new HttpError(409, "This conversation is not waiting for Staff.", "CONVERSATION_NOT_WAITING");
  }

  const now = new Date().toISOString();
  let query = supabaseAdmin
    .from("conversations")
    .update({ mode: "STAFF_ACTIVE", assigned_staff_id: input.staffId, accepted_at: now, updated_at: now })
    .eq("id", input.conversationId)
    .eq("status", "OPEN")
    .eq("mode", "WAITING_FOR_STAFF");
  query = conversation.assignedStaffId ? query.eq("assigned_staff_id", input.staffId) : query.is("assigned_staff_id", null);
  const { data, error } = await query.select(conversationBaseSelect).maybeSingle();
  if (error) throw HttpError.fromSupabase(error);
  if (!data) throw new HttpError(409, "Another Staff member accepted this conversation first.", "CONVERSATION_ALREADY_ASSIGNED");

  const accepted = mapConversation(data as unknown as RawConversation, input.staffId);
  await insertConversationMessage({
    conversationId: input.conversationId,
    senderType: "SYSTEM",
    message: `You are now connected to ${accepted.assignedStaff?.fullName || "Commissary Staff"}. WesBot automatic replies are off.`
  });
  await createNotification({
    userId: accepted.studentId,
    type: "MESSAGE",
    title: "Staff joined your support conversation",
    message: `${accepted.assignedStaff?.fullName || "Commissary Staff"} is now handling ${accepted.subject}.`
  });
  await safelyRecordAuditLog({
    actorId: input.staffId,
    action: "SUPPORT_CONVERSATION_ACCEPTED",
    entityType: "conversation",
    entityId: input.conversationId,
    summary: "Accepted a WesBot handoff.",
    metadata: { studentId: accepted.studentId }
  });
  return requireConversation(input.conversationId, input.staffId);
}

export async function returnConversationToBot(input: { conversationId: string; performedById: string; performedByRole: AppRole }) {
  if (!env.WESBOT_ENABLED) throw new HttpError(503, "WesBot is currently unavailable.", "WESBOT_DISABLED");
  const conversation = await requireConversation(input.conversationId, input.performedById);
  if (conversation.status === "RESOLVED") throw new HttpError(409, "Reopen this conversation before returning it to WesBot.");
  if (conversation.mode !== "STAFF_ACTIVE") {
    throw new HttpError(409, "Only a Staff-managed conversation can be returned to WesBot.", "CONVERSATION_NOT_STAFF_ACTIVE");
  }
  if (input.performedByRole !== "ADMIN" && conversation.assignedStaffId !== input.performedById) {
    throw new HttpError(409, "Only the assigned Staff member or an Administrator can return this conversation to WesBot.", "CONVERSATION_ALREADY_ASSIGNED");
  }

  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("conversations")
    .update({
      mode: "BOT_ACTIVE",
      assigned_staff_id: null,
      accepted_at: null,
      escalation_reason: null,
      escalated_at: null,
      priority: 0,
      updated_at: now
    })
    .eq("id", input.conversationId);
  if (error) throw HttpError.fromSupabase(error);

  await insertConversationMessage({
    conversationId: input.conversationId,
    senderType: "SYSTEM",
    message: "This conversation has returned to WesBot. Ask a new question anytime, or choose Talk to Staff again."
  });
  await safelyRecordAuditLog({
    actorId: input.performedById,
    action: "SUPPORT_RETURNED_TO_BOT",
    entityType: "conversation",
    entityId: input.conversationId,
    summary: "Returned a Staff conversation to WesBot.",
    metadata: { studentId: conversation.studentId }
  });
  return requireConversation(input.conversationId, input.performedById);
}

export async function updateConversationStatus(input: {
  conversationId: string;
  status: ConversationStatus;
  performedById: string;
}) {
  const conversation = await requireConversation(input.conversationId, input.performedById);
  const now = new Date().toISOString();
  const mode: ConversationMode = input.status === "RESOLVED" ? "RESOLVED" : "STAFF_ACTIVE";
  const { data, error } = await supabaseAdmin
    .from("conversations")
    .update({
      status: input.status,
      mode,
      assigned_staff_id: conversation.assignedStaffId ?? input.performedById,
      resolved_at: input.status === "RESOLVED" ? now : null,
      accepted_at: input.status === "OPEN" ? (conversation.acceptedAt ?? now) : conversation.acceptedAt,
      updated_at: now
    })
    .eq("id", input.conversationId)
    .select(conversationBaseSelect)
    .single();
  if (error) throw HttpError.fromSupabase(error);

  const updatedConversation = mapConversation(data as unknown as RawConversation);
  if (input.status === "RESOLVED") {
    await createNotification({
      userId: conversation.studentId,
      type: "MESSAGE",
      title: "Support conversation resolved",
      message: "Your support conversation has been marked as resolved."
    });
  }

  if (conversation.status !== input.status) {
    await safelyRecordAuditLog({
      actorId: input.performedById,
      action: "SUPPORT_STATUS_UPDATED",
      entityType: "conversation",
      entityId: input.conversationId,
      summary: `Marked a support conversation as ${input.status.toLowerCase()}.`,
      metadata: {
        previousStatus: conversation.status,
        nextStatus: input.status,
        previousMode: conversation.mode,
        nextMode: mode,
        studentId: conversation.studentId
      }
    });
  }
  return updatedConversation;
}

export async function setConversationTyping(input: {
  conversationId: string;
  userId: string;
  role: AppRole;
  profile: { fullName: string; email: string };
  isTyping: boolean;
}) {
  const conversation = await requireConversation(input.conversationId, input.userId);
  assertConversationAccess(conversation, input.userId, input.role);

  if (
    input.isTyping
    && input.role !== "STUDENT"
    && (conversation.mode !== "STAFF_ACTIVE" || conversation.assignedStaffId !== input.userId)
  ) {
    throw new HttpError(409, "Accept this conversation before sending a typing indicator.", "CONVERSATION_ACCEPT_REQUIRED");
  }

  if (!input.isTyping) {
    clearTypingUser(input.conversationId, input.userId);
    return getTypingUsers(input.conversationId, input.userId);
  }

  const users = typingState.get(input.conversationId) ?? new Map<string, TypingUser>();
  users.set(input.userId, {
    userId: input.userId,
    fullName: input.profile.fullName || input.profile.email,
    email: input.profile.email,
    role: input.role,
    updatedAt: new Date().toISOString()
  });
  typingState.set(input.conversationId, users);
  return getTypingUsers(input.conversationId, input.userId);
}
