import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { requireRole } from "../middleware/require-role.js";
import {
  getOperationalStudentSummary,
  listOperationalStudentOffenses,
  listOperationalStudentReceipts,
  listOperationalStudentReservations,
  listOperationalStudentRestrictions,
  listOperationalStudents,
  listOperationalStudentScheduleHistory
} from "../services/student-operations.service.js";
import { asyncHandler } from "../utils/async-handler.js";

export const staffStudentsRoutes = Router();

const studentIdSchema = z.string().uuid();
const pageSchema = z.object({
  cursor: z.string().trim().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional()
});
const studentListSchema = pageSchema.extend({ query: z.string().trim().max(120).optional() });

staffStudentsRoutes.use(requireAuth, requireRole("STAFF", "ADMIN"));

staffStudentsRoutes.get(
  "/",
  asyncHandler(async (request, response) => {
    response.json(await listOperationalStudents(studentListSchema.parse(request.query)));
  })
);

staffStudentsRoutes.get(
  "/:studentId/summary",
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const summary = await getOperationalStudentSummary(
      studentIdSchema.parse(request.params.studentId),
      request.auth!.id
    );
    response.json({ summary });
  })
);

staffStudentsRoutes.get(
  "/:studentId/reservations",
  asyncHandler(async (request, response) => {
    response.json(await listOperationalStudentReservations(
      studentIdSchema.parse(request.params.studentId),
      pageSchema.parse(request.query)
    ));
  })
);

staffStudentsRoutes.get(
  "/:studentId/receipts",
  asyncHandler(async (request, response) => {
    response.json(await listOperationalStudentReceipts(
      studentIdSchema.parse(request.params.studentId),
      pageSchema.parse(request.query)
    ));
  })
);

staffStudentsRoutes.get(
  "/:studentId/schedule-history",
  asyncHandler(async (request, response) => {
    response.json(await listOperationalStudentScheduleHistory(
      studentIdSchema.parse(request.params.studentId),
      pageSchema.parse(request.query)
    ));
  })
);

staffStudentsRoutes.get(
  "/:studentId/restrictions",
  asyncHandler(async (request, response) => {
    response.json(await listOperationalStudentRestrictions(
      studentIdSchema.parse(request.params.studentId),
      pageSchema.parse(request.query)
    ));
  })
);

staffStudentsRoutes.get(
  "/:studentId/offenses",
  asyncHandler(async (request, response) => {
    response.json(await listOperationalStudentOffenses(
      studentIdSchema.parse(request.params.studentId),
      pageSchema.parse(request.query)
    ));
  })
);
