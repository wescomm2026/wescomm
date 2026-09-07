import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import {
  getLatestRealtimeEventId,
  listRealtimeEvents
} from "../services/realtime-event.service.js";
import { asyncHandler } from "../utils/async-handler.js";

const MAX_EVENT_ID = 9_223_372_036_854_775_807n;
const POLL_BATCH_SIZE = 100;
const cursorSchema = z.string().regex(/^\d{1,19}$/).refine((value) => BigInt(value) <= MAX_EVENT_ID).optional();

export const realtimeRoutes = Router();

// A 204 response tells legacy EventSource clients to stop reconnecting. Keeping
// this compatibility endpoint prevents an older open tab from repeatedly
// starting long-lived Fluid Compute invocations after the polling rollout.
realtimeRoutes.get("/events", (_request, response) => {
  response.setHeader("Cache-Control", "private, no-store, max-age=0");
  response.status(204).end();
});

realtimeRoutes.get(
  "/updates",
  requireAuth,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const requestedCursor = cursorSchema.parse(request.query.cursor);
    const cursor = requestedCursor
      ? BigInt(requestedCursor)
      : await getLatestRealtimeEventId(request.auth!.id, request.auth!.role);
    const events = await listRealtimeEvents({
      userId: request.auth!.id,
      role: request.auth!.role,
      afterId: cursor,
      limit: POLL_BATCH_SIZE
    });
    const nextCursor = events.at(-1)?.id ?? cursor;

    response.setHeader("Cache-Control", "private, no-store, max-age=0");
    response.json({
      cursor: nextCursor.toString(),
      hasMore: events.length === POLL_BATCH_SIZE,
      events: events.map((event) => ({
        id: event.id.toString(),
        topic: event.topic,
        entityId: event.entityId,
        payload: event.payload,
        createdAt: event.createdAt.toISOString()
      }))
    });
  })
);
