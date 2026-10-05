"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import { useRealtimeRefresh } from "@/components/realtime/RealtimeProvider";
import { getStudentOverviewFromApi, isRequestAbortError, type StudentOverview } from "@/lib/api";
import { userFacingErrorMessage } from "@/lib/user-facing-error";

/** Live counts, next pickup, and spending for the signed-in student, kept fresh by realtime events. */
export function useStudentOverview() {
  const { user } = useStudentAuth();
  const token = user?.role === "STUDENT" ? user.accessToken ?? "" : "";
  const [overview, setOverview] = useState<StudentOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async (background = false) => {
    if (!token) {
      setOverview(null);
      setLoading(false);
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    if (!background) setLoading(true);
    try {
      const next = await getStudentOverviewFromApi(token, controller.signal);
      if (controller.signal.aborted) return;
      if (!next?.reservations || !next.receipts) throw new Error("Account summary is unavailable.");
      setOverview(next);
      setError("");
    } catch (loadError) {
      if (isRequestAbortError(loadError) || controller.signal.aborted) return;
      if (!background) setError(userFacingErrorMessage(loadError, "Unable to load your account summary."));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

  const refreshTimer = useRef<number | null>(null);
  useRealtimeRefresh(["reservations", "receipts"], () => {
    if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => void load(true), 800);
  });
  useEffect(() => () => {
    if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
  }, []);

  return { overview, loading, error, reload: () => load() };
}
