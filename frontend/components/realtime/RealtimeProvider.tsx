"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import {
  AUTH_UNAUTHORIZED_EVENT,
  COOKIE_SESSION_TOKEN,
  getRealtimeUpdatesFromApi,
  requestProductsRefresh,
  type BackendRealtimeUpdate
} from "@/lib/api";

export const REALTIME_UPDATE_EVENT = "wescomm:realtime-update";
const REALTIME_POLL_INTERVAL_MS = 15_000;

export type RealtimeTopic = BackendRealtimeUpdate["topic"];
export type RealtimeUpdate = Omit<BackendRealtimeUpdate, "id">;

function dispatchUpdate(update: BackendRealtimeUpdate, currentUserId: string) {
  window.dispatchEvent(new CustomEvent<RealtimeUpdate>(REALTIME_UPDATE_EVENT, { detail: update }));
  if (update.topic === "inventory") {
    requestProductsRefresh(update);
  }
  if (update.topic === "users" && update.entityId === currentUserId) {
    window.dispatchEvent(new Event(AUTH_UNAUTHORIZED_EVENT));
  }
}

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { ready, user } = useStudentAuth();

  useEffect(() => {
    if (!ready || !user?.id) return undefined;

    const storageKey = `wescomm:realtime-cursor:${user.id}`;
    const accessToken = user.accessToken ?? COOKIE_SESSION_TOKEN;
    const currentUserId = user.id;
    let active = true;
    let polling = false;
    let timer: number | null = null;

    const clearTimer = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
    };
    const schedule = (delayMs = REALTIME_POLL_INTERVAL_MS) => {
      clearTimer();
      if (active) timer = window.setTimeout(() => void poll(), delayMs);
    };
    const poll = async () => {
      if (!active || polling) return;
      if (document.visibilityState === "hidden" || !navigator.onLine) {
        schedule();
        return;
      }

      polling = true;
      try {
        const savedCursor = window.sessionStorage.getItem(storageKey) ?? undefined;
        const result = await getRealtimeUpdatesFromApi(accessToken, savedCursor);
        if (!active) return;
        if (/^\d+$/.test(result.cursor)) {
          window.sessionStorage.setItem(storageKey, result.cursor);
        }
        for (const update of result.events) {
          dispatchUpdate(update, currentUserId);
        }
        schedule(result.hasMore ? 0 : REALTIME_POLL_INTERVAL_MS);
      } catch {
        if (active) schedule();
      } finally {
        polling = false;
      }
    };
    const pollWhenVisible = () => {
      if (document.visibilityState !== "visible" || polling) return;
      clearTimer();
      void poll();
    };

    document.addEventListener("visibilitychange", pollWhenVisible);
    window.addEventListener("online", pollWhenVisible);
    void poll();

    return () => {
      active = false;
      clearTimer();
      document.removeEventListener("visibilitychange", pollWhenVisible);
      window.removeEventListener("online", pollWhenVisible);
    };
  }, [ready, user?.accessToken, user?.id]);

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
