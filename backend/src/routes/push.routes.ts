import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { createRateLimiter, userRateLimitKey } from "../middleware/rate-limit.js";
import { createNotification } from "../services/notification.service.js";
import {
  getPushPublicConfig,
  removePushSubscription,
  savePushSubscription
} from "../services/push.service.js";
import { asyncHandler } from "../utils/async-handler.js";
import { HttpError } from "../utils/http-error.js";

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(4096),
  keys: z.object({
    p256dh: z.string().min(1).max(1024),
    auth: z.string().min(1).max(1024)
  })
});

const removeSubscriptionSchema = z.object({
  endpoint: z.string().url().max(4096)
});

const subscriptionLimiter = createRateLimiter({
  namespace: "push-subscription",
  windowMs: 60 * 60 * 1000,
  max: 20,
  key: userRateLimitKey
});
const pushTestLimiter = createRateLimiter({
  namespace: "push-test",
  windowMs: 10 * 60 * 1000,
  max: 5,
  key: userRateLimitKey,
  message: "Notification test limit reached. Please try again later."
});

export const pushRoutes = Router();

pushRoutes.get(
  "/public-key",
  asyncHandler(async (_request, response) => {
    response.json(getPushPublicConfig());
  })
);

pushRoutes.use(requireAuth);

pushRoutes.post(
  "/subscriptions",
  subscriptionLimiter,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const config = getPushPublicConfig();
    if (!config.enabled) throw new HttpError(503, "Web push is not configured on the backend.");

    const subscription = subscriptionSchema.parse(request.body.subscription ?? request.body);
    await savePushSubscription({
      userId: request.auth!.id,
      subscription,
      userAgent: request.headers["user-agent"]
    });

    response.status(201).json({ ok: true });
  })
);

pushRoutes.delete(
  "/subscriptions",
  subscriptionLimiter,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const { endpoint } = removeSubscriptionSchema.parse(request.body);
    await removePushSubscription({ userId: request.auth!.id, endpoint });
    response.json({ ok: true });
  })
);

pushRoutes.post(
  "/test",
  pushTestLimiter,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const notification = await createNotification({
      userId: request.auth!.id,
      type: "SYSTEM",
      title: "WESCOMM notifications enabled",
      message: "You will now receive important reservation, receipt, support, and stock updates on this device."
    });

    response.json({ notification });
  })
);
