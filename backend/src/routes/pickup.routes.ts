import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { createRateLimiter, userRateLimitKey } from "../middleware/rate-limit.js";
import { requireRole } from "../middleware/require-role.js";
import {
  createPickupPolicyVersion,
  getCurrentPickupPolicy,
  getPickupAvailability,
  listPickupPolicyVersions,
  previewPickupPolicy
} from "../services/pickup-policy.service.js";
import { asyncHandler } from "../utils/async-handler.js";

export const pickupRoutes = Router();

const dateKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must use YYYY-MM-DD.");
const policySchema = z.object({
  minAdvanceDays: z.number().int().min(0).max(365),
  maxAdvanceDays: z.number().int().min(1).max(3650),
  reason: z.string().trim().min(5).max(500),
  days: z.array(z.object({
    weekday: z.number().int().min(0).max(6),
    enabled: z.boolean()
  })).length(7),
  timeSlots: z.array(z.object({
    label: z.string().trim().min(3).max(80),
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
    isActive: z.boolean()
  })).min(1).max(20),
  closures: z.array(z.object({
    date: dateKeySchema,
    reason: z.string().trim().min(2).max(200)
  })).max(366)
}).superRefine((input, context) => {
  if (input.maxAdvanceDays < input.minAdvanceDays) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Maximum advance days must be at least the minimum.", path: ["maxAdvanceDays"] });
  }
  if (new Set(input.days.map((day) => day.weekday)).size !== 7) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Configure each weekday exactly once.", path: ["days"] });
  }
  if (!input.days.some((day) => day.enabled)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Enable at least one pickup weekday.", path: ["days"] });
  }
  if (!input.timeSlots.some((slot) => slot.isActive)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Keep at least one pickup time active.", path: ["timeSlots"] });
  }
  const activeSlots = [...input.timeSlots.filter((slot) => slot.isActive)].sort((left, right) => left.startMinute - right.startMinute);
  activeSlots.forEach((slot, index) => {
    if (slot.endMinute <= slot.startMinute) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Slot end must be later than its start.", path: ["timeSlots", input.timeSlots.indexOf(slot), "endMinute"] });
    }
    if (index > 0 && activeSlots[index - 1].endMinute > slot.startMinute) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Active pickup times cannot overlap.", path: ["timeSlots"] });
    }
  });
  if (new Set(input.closures.map((closure) => closure.date)).size !== input.closures.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Each closure date can appear only once.", path: ["closures"] });
  }
});

const pickupPolicyWriteLimiter = createRateLimiter({
  namespace: "pickup-policy-write",
  windowMs: 15 * 60 * 1000,
  max: 20,
  key: userRateLimitKey,
  message: "Pickup policy update limit reached. Please wait and try again."
});

pickupRoutes.get(
  "/availability",
  asyncHandler(async (_request, response) => {
    response.setHeader("Cache-Control", "private, max-age=30, stale-while-revalidate=30");
    response.json({ policy: await getPickupAvailability() });
  })
);

pickupRoutes.get(
  "/policies/current",
  requireAuth,
  requireRole("STAFF", "ADMIN"),
  asyncHandler(async (_request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.json({ policy: await getCurrentPickupPolicy() });
  })
);

pickupRoutes.get(
  "/policies",
  requireAuth,
  requireRole("STAFF", "ADMIN"),
  asyncHandler(async (request, response) => {
    const limit = z.coerce.number().int().min(1).max(50).default(20).parse(request.query.limit);
    response.json({ policies: await listPickupPolicyVersions(limit) });
  })
);

pickupRoutes.post(
  "/policies/preview",
  requireAuth,
  requireRole("STAFF", "ADMIN"),
  pickupPolicyWriteLimiter,
  asyncHandler(async (request, response) => {
    response.json({ preview: await previewPickupPolicy(policySchema.parse(request.body)) });
  })
);

pickupRoutes.post(
  "/policies",
  requireAuth,
  requireRole("STAFF", "ADMIN"),
  pickupPolicyWriteLimiter,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const result = await createPickupPolicyVersion(policySchema.parse(request.body), request.auth!.id);
    response.status(201).json(result);
  })
);
