"use client";

import { userFacingErrorMessage } from "@/lib/user-facing-error";

import { useCallback, useEffect, useRef, useState } from "react";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import { getAdminWesbotUsageFromApi, isRequestAbortError, type BackendWesbotUsageSummary } from "@/lib/api";

export function useAdminWesbotUsage() {
  const { user, ready, openAuth } = useStudentAuth();
  const [usage, setUsage] = useState<BackendWesbotUsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestRef = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    if (!ready) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;

    if (!user?.accessToken || user.role !== "ADMIN") {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    try {
      setUsage(await getAdminWesbotUsageFromApi(user.accessToken, controller.signal));
    } catch (usageError) {
      if (!isRequestAbortError(usageError)) {
        setError(userFacingErrorMessage(usageError, "Unable to load WesBot usage."));
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [ready, user?.accessToken, user?.role]);

  useEffect(() => {
    void reload();
    return () => requestRef.current?.abort();
  }, [reload]);

  return { user, ready, openAuth, usage, loading, error, reload };
}
