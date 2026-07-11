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
  limit: z.coerce.number().int().min(1).max(200).optional()
});

auditLogsRoutes.get(
  "/",
  asyncHandler(async (request, response) => {
    const filters = auditLogQuerySchema.parse(request.query);
    const auditLogs = await listAuditLogs(filters);
    response.json({ auditLogs });
  })
);
