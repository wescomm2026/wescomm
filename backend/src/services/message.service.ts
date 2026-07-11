import { supabaseAdmin } from "../lib/supabase.js";
import { safelyRecordAuditLog } from "./audit-log.service.js";
import { createNotification, createNotificationsForRoles } from "./notification.service.js";
import { type AppRole, type ConversationStatus, type RawProfileSummary, mapProfileSummary } from "../types/app.js";
import { decryptSensitiveText, encryptSensitiveText } from "../utils/field-encryption.js";
import { HttpError } from "../utils/http-error.js";

const TYPING_TTL_MS = 6000;

type TypingUser = {
  userId: string;
  fullName: string;
  email: string;
  role: AppRole;
  updatedAt: string;
};

const typingState = new Map<string, Map<string, TypingUser>>();

type RawConversationMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  message: string;
  created_at: string;
  sender?: RawProfileSummary | RawProfileSummary[] | null;
};

type RawConversation = {
  id: string;
  student_id: string;
  assigned_staff_id: string | null;
  subject: string;
  status: string;
  created_at: string;
  updated_at: string;
  student: RawProfileSummary | RawProfileSummary[] | null;
  assignedStaff: RawProfileSummary | RawProfileSummary[] | null;
  messages: RawConversationMessage[] | null;
};

const conversationSelect = `
  id,
  student_id,
  assigned_staff_id,
  subject,
  status,
  created_at,
  updated_at,
  student:profiles!conversations_student_id_fkey(id,full_name,email,student_number),
  assignedStaff:profiles!conversations_assigned_staff_id_fkey(id,full_name,email,student_number),
  messages:conversation_messages(
    id,
    conversation_id,
    sender_id,
    message,
    created_at,
    sender:profiles!conversation_messages_sender_id_fkey(id,full_name,email,student_number)
  )
`;

function mapMessage(row: RawConversationMessage) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    message: decryptSensitiveText(row.message, "conversation.message") ?? "",
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
      if (now - new Date(typingUser.updatedAt).getTime() > TYPING_TTL_MS) {
        users.delete(userId);
      }
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    student: mapProfileSummary(row.student),
    assignedStaff: mapProfileSummary(row.assignedStaff),
    messages: (row.messages ?? [])
      .map(mapMessage)
      .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt))),
    typingUsers: getTypingUsers(row.id, viewerId)
  };
}

async function requireConversation(conversationId: string, viewerId?: string) {
  const { data, error } = await supabaseAdmin
    .from("conversations")
    .select(conversationSelect)
    .eq("id", conversationId)
    .maybeSingle();

  if (error) throw new HttpError(500, error.message);
  if (!data) throw new HttpError(404, "Conversation not found.");
  return mapConversation(data as RawConversation, viewerId);
}

function assertConversationAccess(conversation: ReturnType<typeof mapConversation>, userId: string, role: AppRole) {
  if (role === "STUDENT" && conversation.studentId !== userId) {
    throw new HttpError(403, "You do not have access to this conversation.");
  }
}

export async function listConversations(userId: string, role: AppRole) {
  let query = supabaseAdmin.from("conversations").select(conversationSelect).order("updated_at", { ascending: false });
  if (role === "STUDENT") query = query.eq("student_id", userId);

  const { data, error } = await query;
  if (error) throw new HttpError(500, error.message);
  const conversations = ((data ?? []) as RawConversation[]).map((conversation) => mapConversation(conversation, userId));
  return role === "STUDENT"
    ? conversations.filter((conversation) => conversation.studentId === userId)
    : conversations;
}

export async function createConversation(input: {
  studentId: string;
  subject: string;
  message: string;
}) {
  const { data: conversationData, error: conversationError } = await supabaseAdmin
    .from("conversations")
    .insert({
      student_id: input.studentId,
      subject: encryptSensitiveText(input.subject.trim(), "conversation.subject"),
      status: "OPEN"
    })
    .select("id")
    .single();

  if (conversationError) throw new HttpError(500, conversationError.message);

  const conversation = conversationData as { id: string };
  const { error: messageError } = await supabaseAdmin.from("conversation_messages").insert({
    conversation_id: conversation.id,
    sender_id: input.studentId,
    message: encryptSensitiveText(input.message.trim(), "conversation.message")
  });

  if (messageError) throw new HttpError(500, messageError.message);

  const createdConversation = await requireConversation(conversation.id, input.studentId);
  await createNotificationsForRoles(["STAFF", "ADMIN"], {
    type: "MESSAGE",
    title: "New student support message",
    message: `${createdConversation.student?.fullName || createdConversation.student?.email || "A student"} started a support conversation.`
  });

  return createdConversation;
}

export async function createMessage(input: {
  conversationId: string;
  senderId: string;
  senderRole: AppRole;
  message: string;
}) {
  const conversation = await requireConversation(input.conversationId, input.senderId);
  assertConversationAccess(conversation, input.senderId, input.senderRole);
  clearTypingUser(input.conversationId, input.senderId);

  const updateConversation: Record<string, unknown> = {
    status: "OPEN",
    updated_at: new Date().toISOString()
  };

  if (input.senderRole !== "STUDENT" && !conversation.assignedStaffId) {
    updateConversation.assigned_staff_id = input.senderId;
  }

  const { data, error } = await supabaseAdmin
    .from("conversation_messages")
    .insert({
      conversation_id: input.conversationId,
      sender_id: input.senderId,
      message: encryptSensitiveText(input.message, "conversation.message")
    })
    .select("id,conversation_id,sender_id,message,created_at,sender:profiles!conversation_messages_sender_id_fkey(id,full_name,email,student_number)")
    .single();

  if (error) throw new HttpError(500, error.message);

  const { error: updateError } = await supabaseAdmin
    .from("conversations")
    .update(updateConversation)
    .eq("id", input.conversationId);

  if (updateError) throw new HttpError(500, updateError.message);

  const message = mapMessage(data as RawConversationMessage);

  if (input.senderRole === "STUDENT") {
    await createNotificationsForRoles(["STAFF", "ADMIN"], {
      type: "MESSAGE",
      title: "Student replied in support",
      message: `${conversation.student?.fullName || conversation.student?.email || "A student"} sent a support reply.`
    });
  } else {
    await createNotification({
      userId: conversation.studentId,
      type: "MESSAGE",
      title: "Support replied",
      message: `Commissary staff replied to ${conversation.subject}.`
    });

    await safelyRecordAuditLog({
      actorId: input.senderId,
      action: "SUPPORT_MESSAGE_SENT",
      entityType: "conversation",
      entityId: input.conversationId,
      summary: "Sent a support conversation reply.",
      metadata: {
        studentId: conversation.studentId
      }
    });
  }

  return message;
}

export async function updateConversationStatus(input: {
  conversationId: string;
  status: ConversationStatus;
  performedById: string;
}) {
  const conversation = await requireConversation(input.conversationId, input.performedById);

  const { data, error } = await supabaseAdmin
    .from("conversations")
    .update({
      status: input.status,
      assigned_staff_id: conversation.assignedStaffId ?? input.performedById,
      updated_at: new Date().toISOString()
    })
    .eq("id", input.conversationId)
    .select(conversationSelect)
    .single();

  if (error) throw new HttpError(500, error.message);

  const updatedConversation = mapConversation(data as RawConversation);

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
  profile: {
    fullName: string;
    email: string;
  };
  isTyping: boolean;
}) {
  const conversation = await requireConversation(input.conversationId, input.userId);
  assertConversationAccess(conversation, input.userId, input.role);

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
