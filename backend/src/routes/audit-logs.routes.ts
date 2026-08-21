import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/require-role.js";
import { listAuditLogs } from "../services/audit-log.service.js";
import { asyncHandler } from "../utils/async-handler.js";

export const auditLogsRoutes = Router();

auditLogsRoutes.use(requireAuth, requireRole("ADMIN"));

const auditLogQuerySchema = z.object({
  action: z.string().trim().max(120).optional(),
  entityType: z.string().trim().max(120).optional(),
  actorId: z.string().uuid().optional(),
  query: z.string().trim().max(160).optional(),
  cursor: z.string().trim().min(1).max(512).optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional()
}).superRefine((input, context) => {
  if (input.dateFrom && input.dateTo && input.dateTo < input.dateFrom) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "dateTo must not be before dateFrom.", path: ["dateTo"] });
  }
});

auditLogsRoutes.get(
  "/",
  asyncHandler(async (request, response) => {
    const filters = auditLogQuerySchema.parse(request.query);
    const page = await listAuditLogs(filters);
    response.json(page);
  })
);
