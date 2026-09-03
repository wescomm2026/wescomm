"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import {
  API_BASE_URL,
  AUTH_UNAUTHORIZED_EVENT,
  requestProductsRefresh
} from "@/lib/api";

export const REALTIME_UPDATE_EVENT = "wescomm:realtime-update";

export type RealtimeTopic =
  | "reservations"
  | "receipts"
  | "notifications"
  | "conversations"
  | "typing"
  | "inventory"
  | "dashboard"
  | "reports"
  | "restrictions"
  | "users";

export type RealtimeUpdate = {
  topic: RealtimeTopic;
  entityId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
};

function parseUpdate(value: string): RealtimeUpdate | null {
  try {
    const parsed = JSON.parse(value) as Partial<RealtimeUpdate>;
    if (!parsed.topic || !parsed.createdAt || !parsed.payload || typeof parsed.payload !== "object") return null;
    return parsed as RealtimeUpdate;
  } catch {
    return null;
  }
}

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { ready, user } = useStudentAuth();

  useEffect(() => {
    if (!ready || !user?.id) return undefined;

    const storageKey = `wescomm:realtime-cursor:${user.id}`;
    const url = new URL(`${API_BASE_URL}/realtime/events`, window.location.origin);
    const savedCursor = window.sessionStorage.getItem(storageKey);
    if (savedCursor && /^\d+$/.test(savedCursor)) url.searchParams.set("cursor", savedCursor);

    const stream = new EventSource(url.toString(), { withCredentials: true });
    const handleReady = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as { cursor?: string };
        if (payload.cursor && /^\d+$/.test(payload.cursor)) {
          window.sessionStorage.setItem(storageKey, payload.cursor);
        }
      } catch {
        // A malformed readiness frame should not terminate browser reconnects.
      }
    };
    const handleUpdate = (event: MessageEvent<string>) => {
      const update = parseUpdate(event.data);
      if (!update) return;
      if (event.lastEventId && /^\d+$/.test(event.lastEventId)) {
        window.sessionStorage.setItem(storageKey, event.lastEventId);
      }
      window.dispatchEvent(new CustomEvent<RealtimeUpdate>(REALTIME_UPDATE_EVENT, { detail: update }));
      if (update.topic === "inventory") {
        requestProductsRefresh(update);
      }
      if (update.topic === "users" && update.entityId === user.id) {
        window.dispatchEvent(new Event(AUTH_UNAUTHORIZED_EVENT));
      }
    };

    stream.addEventListener("ready", handleReady as EventListener);
    stream.addEventListener("update", handleUpdate as EventListener);
    return () => {
      stream.removeEventListener("ready", handleReady as EventListener);
      stream.removeEventListener("update", handleUpdate as EventListener);
      stream.close();
    };
  }, [ready, user?.id]);

  return children;
}

export function useRealtimeRefresh(topics: RealtimeTopic[], refresh: (update: RealtimeUpdate) => void) {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const topicKey = topics.join("|");

  useEffect(() => {
    const allowedTopics = new Set(topicKey.split("|").filter(Boolean));
    const handleUpdate = (event: Event) => {
      const update = (event as CustomEvent<RealtimeUpdate>).detail;
      if (update && allowedTopics.has(update.topic)) refreshRef.current(update);
    };
    window.addEventListener(REALTIME_UPDATE_EVENT, handleUpdate);
    return () => window.removeEventListener(REALTIME_UPDATE_EVENT, handleUpdate);
  }, [topicKey]);
}
