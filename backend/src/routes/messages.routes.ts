import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { createRateLimiter, userRateLimitKey } from "../middleware/rate-limit.js";
import { requireRole } from "../middleware/require-role.js";
import {
  acceptConversation,
  createConversation,
  createBotReplyForMessage,
  createMessage,
  listConversationMessages,
  listConversations,
  requestStaffHandoff,
  returnConversationToBot,
  setConversationTyping,
  updateConversationStatus
} from "../services/message.service.js";
import { CONVERSATION_STATUSES } from "../types/app.js";
import { asyncHandler } from "../utils/async-handler.js";
import { measureRequestPhase } from "../middleware/request-timing.js";

export const messagesRoutes = Router();

const messageSchema = z.object({
  message: z.string().trim().min(1).max(2000)
});

const conversationSchema = z.object({
  subject: z.string().trim().min(3).max(120),
  message: z.string().trim().min(1).max(2000)
});

const statusSchema = z.object({
  status: z.enum(CONVERSATION_STATUSES)
});

const typingSchema = z.object({
  isTyping: z.boolean()
});

const handoffSchema = z.object({
  reason: z.string().trim().min(3).max(500).optional()
});

const conversationIdSchema = z.string().uuid();
const conversationCreateLimiter = createRateLimiter({
  namespace: "conversation-create",
  windowMs: 15 * 60 * 1000,
  max: 10,
  key: userRateLimitKey,
  message: "Too many new support conversations. Please continue an existing conversation or try again later."
});
const messageCreateLimiter = createRateLimiter({
  namespace: "conversation-message",
  windowMs: 60 * 1000,
  max: 30,
  key: userRateLimitKey,
  message: "You are sending messages too quickly. Please wait a moment."
});
const typingLimiter = createRateLimiter({
  namespace: "conversation-typing",
  windowMs: 60 * 1000,
  max: 120,
  key: userRateLimitKey
});
const conversationStatusLimiter = createRateLimiter({
  namespace: "conversation-status",
  windowMs: 10 * 60 * 1000,
  max: 100,
  key: userRateLimitKey
});

messagesRoutes.use(requireAuth);

messagesRoutes.get(
  "/",
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const query = z.object({ limit: z.coerce.number().int().min(1).max(50).optional() }).parse(request.query);
    const conversations = await measureRequestPhase(response, "message_query", () =>
      listConversations(request.auth!.id, request.auth!.role, query.limit)
    );
    response.json({ conversations });
  })
);

messagesRoutes.get(
  "/:conversationId/messages",
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const query = z.object({
      limit: z.coerce.number().int().min(1).max(100).optional(),
      before: z.string().datetime({ offset: true }).optional(),
      after: z.string().datetime({ offset: true }).optional()
    }).refine((value) => !(value.before && value.after), "Use either before or after, not both.").parse(request.query);
    const result = await measureRequestPhase(response, "message_query", () => listConversationMessages({
      conversationId: conversationIdSchema.parse(request.params.conversationId),
      userId: request.auth!.id,
      role: request.auth!.role,
      ...query
    }));
    response.json(result);
  })
);

messagesRoutes.post(
  "/",
  requireRole("STUDENT"),
  conversationCreateLimiter,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const input = conversationSchema.parse(request.body);
    const result = await measureRequestPhase(response, "message_command", () => createConversation({
      studentId: request.auth!.id,
      subject: input.subject,
      message: input.message
    }));
    response.status(201).json(result);
  })
);

messagesRoutes.patch(
  "/:conversationId/status",
  requireRole("STAFF", "ADMIN"),
  conversationStatusLimiter,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const input = statusSchema.parse(request.body);
    const conversation = await measureRequestPhase(response, "message_command", () => updateConversationStatus({
      conversationId: conversationIdSchema.parse(request.params.conversationId),
      status: input.status,
      performedById: request.auth!.id
    }));
    response.json({ conversation });
  })
);

messagesRoutes.post(
  "/:conversationId/handoff",
  requireRole("STUDENT"),
  conversationStatusLimiter,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const input = handoffSchema.parse(request.body ?? {});
    const conversation = await measureRequestPhase(response, "message_command", () => requestStaffHandoff({
      conversationId: conversationIdSchema.parse(request.params.conversationId),
      studentId: request.auth!.id,
      reason: input.reason
    }));
    response.json({ conversation });
  })
);

messagesRoutes.post(
  "/:conversationId/accept",
  requireRole("STAFF", "ADMIN"),
  conversationStatusLimiter,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const conversation = await measureRequestPhase(response, "message_command", () => acceptConversation({
      conversationId: conversationIdSchema.parse(request.params.conversationId),
      staffId: request.auth!.id
    }));
    response.json({ conversation });
  })
);

messagesRoutes.post(
  "/:conversationId/return-to-bot",
  requireRole("STAFF", "ADMIN"),
  conversationStatusLimiter,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const conversation = await measureRequestPhase(response, "message_command", () => returnConversationToBot({
      conversationId: conversationIdSchema.parse(request.params.conversationId),
      performedById: request.auth!.id,
      performedByRole: request.auth!.role
    }));
    response.json({ conversation });
  })
);

messagesRoutes.patch(
  "/:conversationId/typing",
  typingLimiter,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const input = typingSchema.parse(request.body);
    const typingUsers = await measureRequestPhase(response, "typing_command", () => setConversationTyping({
      conversationId: conversationIdSchema.parse(request.params.conversationId),
      userId: request.auth!.id,
      role: request.auth!.role,
      profile: {
        fullName: request.auth!.profile.fullName,
        email: request.auth!.email
      },
      isTyping: input.isTyping
    }));
    response.json({ typingUsers });
  })
);

messagesRoutes.post(
  "/:conversationId/messages",
  messageCreateLimiter,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const input = messageSchema.parse(request.body);
    const result = await measureRequestPhase(response, "message_command", () => createMessage({
      conversationId: conversationIdSchema.parse(request.params.conversationId),
      senderId: request.auth!.id,
      senderRole: request.auth!.role,
      message: input.message
    }));
    response.status(201).json(result);
  })
);

messagesRoutes.post(
  "/:conversationId/messages/:messageId/bot-reply",
  requireRole("STUDENT"),
  messageCreateLimiter,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const botMessage = await measureRequestPhase(response, "message_command", () => createBotReplyForMessage({
      conversationId: conversationIdSchema.parse(request.params.conversationId),
      messageId: z.string().uuid().parse(request.params.messageId),
      studentId: request.auth!.id
    }));
    response.status(201).json({ botMessage });
  })
);
