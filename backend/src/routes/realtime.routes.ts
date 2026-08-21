import { Router, type Response } from "express";
import { z } from "zod";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import {
  getLatestRealtimeEventId,
  subscribeToRealtimeEvents
} from "../services/realtime-event.service.js";
import { asyncHandler } from "../utils/async-handler.js";

const STREAM_LIFETIME_MS = 50_000;
const HEARTBEAT_INTERVAL_MS = 15_000;
const MAX_EVENT_ID = 9_223_372_036_854_775_807n;
const cursorSchema = z.string().regex(/^\d{1,19}$/).refine((value) => BigInt(value) <= MAX_EVENT_ID).optional();

function waitForNextPoll(delayMs: number) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function writeEvent(response: Response, input: { id?: bigint; event: string; data: unknown }) {
  if (input.id !== undefined) response.write(`id: ${input.id.toString()}\n`);
  response.write(`event: ${input.event}\n`);
  response.write(`data: ${JSON.stringify(input.data)}\n\n`);
}

export const realtimeRoutes = Router();

realtimeRoutes.get(
  "/events",
  requireAuth,
  asyncHandler(async (request: AuthenticatedRequest, response: Response) => {
    const queryCursor = cursorSchema.parse(request.query.cursor);
    const headerCursor = cursorSchema.parse(request.get("Last-Event-ID") || undefined);
    let cursor = queryCursor || headerCursor
      ? BigInt(queryCursor ?? headerCursor ?? "0")
      : await getLatestRealtimeEventId(request.auth!.id, request.auth!.role);
    let closed = false;
    let lastHeartbeatAt = Date.now();
    const startedAt = Date.now();

    response.locals.longLivedRequest = true;
    response.status(200);
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.setHeader("Cache-Control", "no-cache, no-store, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.setHeader("X-Accel-Buffering", "no");
    response.flushHeaders();
    response.write("retry: 2000\n\n");
    writeEvent(response, {
      event: "ready",
      data: { connected: true, cursor: cursor.toString() }
    });

    const close = () => {
      closed = true;
    };
    response.once("close", close);

    let unsubscribe: () => void = () => {};
    try {
      unsubscribe = await subscribeToRealtimeEvents({
        userId: request.auth!.id,
        role: request.auth!.role,
        afterId: cursor,
        onEvents(events) {
          for (const event of events) {
            cursor = event.id;
            writeEvent(response, {
              id: event.id,
              event: "update",
              data: {
                topic: event.topic,
                entityId: event.entityId,
                payload: event.payload,
                createdAt: event.createdAt.toISOString()
              }
            });
          }
        }
      });

      while (!closed && Date.now() - startedAt < STREAM_LIFETIME_MS) {
        if (Date.now() - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
          response.write(`: heartbeat ${Date.now()}\n\n`);
          lastHeartbeatAt = Date.now();
        }

        await waitForNextPoll(1_000);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown realtime stream error.";
      console.warn(`Realtime stream ended early: ${message}`);
      if (!closed && !response.writableEnded) {
        writeEvent(response, { event: "reconnect", data: { retry: true } });
      }
    } finally {
      unsubscribe();
      response.off("close", close);
      if (!response.writableEnded) response.end();
    }
  })
);
