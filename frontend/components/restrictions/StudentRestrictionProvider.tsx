"use client";

import { userFacingErrorMessage } from "@/lib/user-facing-error";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { Clock3, ShieldAlert } from "lucide-react";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import { useRealtimeRefresh } from "@/components/realtime/RealtimeProvider";
import { getMyRestrictionSummaryFromApi, type BackendRestrictionSummary } from "@/lib/api";

type StudentRestrictionContextValue = {
  summary: BackendRestrictionSummary | null;
  loading: boolean;
  error: string;
  isReservationRestricted: boolean;
  refresh: () => Promise<void>;
};

const StudentRestrictionContext = createContext<StudentRestrictionContextValue | null>(null);

function formatRestrictionEnd(value: string | null) {
  if (!value) return "until an administrator completes the review";
  return `until ${new Intl.DateTimeFormat("en-PH", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Manila"
  }).format(new Date(value))}`;
}

export function StudentRestrictionProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user, ready } = useStudentAuth();
  const [summary, setSummary] = useState<BackendRestrictionSummary | null>(null);
  const [summaryOwnerId, setSummaryOwnerId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestSequenceRef = useRef(0);
  const accountId = user?.id ?? "";
  const visibleSummary = summaryOwnerId === accountId ? summary : null;

  const refresh = useCallback(async () => {
    if (!user?.accessToken || user.role !== "STUDENT" || !accountId) {
      requestSequenceRef.current += 1;
      setSummary(null);
      setSummaryOwnerId(accountId);
      setError("");
      setLoading(false);
      return;
    }

    const requestSequence = ++requestSequenceRef.current;
    setLoading(true);
    try {
      const nextSummary = await getMyRestrictionSummaryFromApi(user.accessToken);
      if (requestSequence !== requestSequenceRef.current) return;
      setSummary(nextSummary);
      setSummaryOwnerId(accountId);
      setError("");
    } catch (requestError) {
      if (requestSequence !== requestSequenceRef.current) return;
      setError(userFacingErrorMessage(requestError, "Unable to check reservation access."));
    } finally {
      if (requestSequence === requestSequenceRef.current) setLoading(false);
    }
  }, [accountId, user?.accessToken, user?.role]);

  useRealtimeRefresh(["restrictions"], () => {
    void refresh();
  });

  useEffect(() => {
    if (!ready) return;
    requestSequenceRef.current += 1;
    setSummary(null);
    setSummaryOwnerId(accountId);
    setError("");
    setLoading(false);
    void refresh();
  }, [accountId, pathname, ready, refresh]);

  useEffect(() => {
    if (!user?.accessToken || user.role !== "STUDENT") return undefined;

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const refreshOnFocus = () => void refresh();
    const refreshFromEvent = () => void refresh();
    const timer = window.setInterval(refreshWhenVisible, 5 * 60_000);

    window.addEventListener("focus", refreshOnFocus);
    window.addEventListener("wescomm:restriction-refresh", refreshFromEvent);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshOnFocus);
      window.removeEventListener("wescomm:restriction-refresh", refreshFromEvent);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [accountId, refresh, user?.accessToken, user?.role]);

  const value = useMemo<StudentRestrictionContextValue>(
    () => ({
      summary: visibleSummary,
      loading,
      error,
      isReservationRestricted: Boolean(visibleSummary?.activeRestriction),
      refresh
    }),
    [error, loading, refresh, visibleSummary]
  );

  return <StudentRestrictionContext.Provider value={value}>{children}</StudentRestrictionContext.Provider>;
}

export function useStudentRestriction() {
  const context = useContext(StudentRestrictionContext);
  if (!context) throw new Error("useStudentRestriction must be used inside StudentRestrictionProvider");
  return context;
}

export function StudentRestrictionNotice() {
  const { summary } = useStudentRestriction();
  const restriction = summary?.activeRestriction;
  const consecutiveOffenses = summary?.consecutiveOffenses ?? 0;

  if (!restriction && consecutiveOffenses === 0) return null;

  if (restriction) {
    return (
      <section className="mb-5 flex flex-col gap-4 rounded-lg border border-[#e6b8b8] bg-[#fff7f7] p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5" role="alert">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-md bg-[#fde7e7] text-[#a22b2b]">
            <ShieldAlert className="size-6" aria-hidden="true" />
          </span>
          <div>
            <p className="font-extrabold text-[#8f2222]">Reservation access is paused</p>
            <p className="mt-1 text-sm leading-6 text-[#604747]">
              {restriction.reason} Your access is paused {formatRestrictionEnd(restriction.endsAt)}. You can still browse items, view receipts, and contact Support.
            </p>
          </div>
        </div>
        <Link
          href="/student/support"
          className="inline-flex h-10 shrink-0 items-center justify-center rounded-md border border-[#d99f9f] bg-white px-4 text-sm font-bold text-[#8f2222] transition hover:bg-[#fff0f0]"
        >
          Contact Support
        </Link>
      </section>
    );
  }

  const finalWarning = consecutiveOffenses >= 2;
  const restoredAfterRestriction = consecutiveOffenses >= (summary?.policy.firstRestrictionAt ?? 3);
  const title = restoredAfterRestriction
    ? "Please keep your next pickup schedule"
    : finalWarning
      ? "Final reservation reminder"
      : "Reservation pickup reminder";
  const message = restoredAfterRestriction
    ? "Your reservation access is available again. Another confirmed unclaimed reservation may lead to a longer suspension."
    : finalWarning
      ? "Two recent reservations were not collected. One more consecutive confirmed no-show may pause your reservation access for 7 days."
      : "A recent reservation was not collected. Completed pickups reset this warning count.";

  return (
    <section className="mb-5 flex items-start gap-3 rounded-lg border border-[#ead7a5] bg-[#fffaf0] p-4 sm:px-5">
      <span className="grid size-11 shrink-0 place-items-center rounded-md bg-[#fff0c7] text-[#8a5b00]">
        <Clock3 className="size-6" aria-hidden="true" />
      </span>
      <div>
        <p className="font-extrabold text-[#684900]">{title}</p>
        <p className="mt-1 text-sm leading-6 text-[#685b3f]">{message}</p>
      </div>
    </section>
  );
}
