"use client";

import Link from "next/link";
import { useCallback, useDeferredValue, useEffect, useRef, useState } from "react";
import { CalendarClock, FileWarning, History, ReceiptText, RefreshCw, Search, ShieldAlert, UserRound } from "lucide-react";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import { useRealtimeRefresh } from "@/components/realtime/RealtimeProvider";
import { Button } from "@/components/ui/button";
import { FeedbackState } from "@/components/ui/FeedbackState";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Surface } from "@/components/ui/Surface";
import {
  getOperationalStudentOffensesFromApi,
  getOperationalStudentReceiptsFromApi,
  getOperationalStudentReservationsFromApi,
  getOperationalStudentRestrictionsFromApi,
  getOperationalStudentsFromApi,
  getOperationalStudentScheduleHistoryFromApi,
  getOperationalStudentSummaryFromApi,
  type BackendCursorPage,
  type BackendOperationalOffense,
  type BackendOperationalReceipt,
  type BackendOperationalReservation,
  type BackendOperationalRestriction,
  type BackendOperationalScheduleChange,
  type BackendOperationalStudent,
  type BackendOperationalStudentSummary
} from "@/lib/api";
import { paymentMethodLabel } from "@/lib/payment-method";
import { userFacingErrorMessage } from "@/lib/user-facing-error";
import { cn } from "@/lib/utils";

type DetailTab = "PROFILE" | "RESERVATIONS" | "RECEIPTS" | "SCHEDULE" | "ACCESS";
type DetailPages = {
  reservations: BackendCursorPage<BackendOperationalReservation>;
  receipts: BackendCursorPage<BackendOperationalReceipt>;
  schedule: BackendCursorPage<BackendOperationalScheduleChange>;
  restrictions: BackendCursorPage<BackendOperationalRestriction>;
  offenses: BackendCursorPage<BackendOperationalOffense>;
};

const EMPTY_PAGE = { items: [], nextCursor: null };

function formatDate(value: string | null, includeTime = false) {
  if (!value) return "Not set";
  return new Date(value).toLocaleString("en-PH", {
    dateStyle: "medium",
    ...(includeTime ? { timeStyle: "short" as const } : {}),
    timeZone: "Asia/Manila"
  });
}

function formatMoney(value: string) {
  return `PHP ${Number(value).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function appendPage<T>(current: BackendCursorPage<T>, next: BackendCursorPage<T>): BackendCursorPage<T> {
  return { items: [...current.items, ...next.items], nextCursor: next.nextCursor };
}

export function StudentsOperationsExperience() {
  const { user } = useStudentAuth();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim());
  const [students, setStudents] = useState<BackendOperationalStudent[]>([]);
  const [studentsCursor, setStudentsCursor] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [summary, setSummary] = useState<BackendOperationalStudentSummary | null>(null);
  const [pages, setPages] = useState<DetailPages>({
    reservations: EMPTY_PAGE,
    receipts: EMPTY_PAGE,
    schedule: EMPTY_PAGE,
    restrictions: EMPTY_PAGE,
    offenses: EMPTY_PAGE
  });
  const [tab, setTab] = useState<DetailTab>("PROFILE");
  const [loading, setLoading] = useState(true);
  const [loadingMoreStudents, setLoadingMoreStudents] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadingMoreDetail, setLoadingMoreDetail] = useState(false);
  const [error, setError] = useState("");
  const directoryRequestRef = useRef(0);
  const detailRequestRef = useRef(0);

  const loadDirectory = useCallback(async ({ cursor, background = false }: { cursor?: string; background?: boolean } = {}) => {
    if (!user?.accessToken || (user.role !== "STAFF" && user.role !== "ADMIN")) return;
    const requestId = ++directoryRequestRef.current;
    if (cursor) setLoadingMoreStudents(true);
    else if (!background) setLoading(true);
    if (!background) setError("");
    try {
      const page = await getOperationalStudentsFromApi(user.accessToken, { query: deferredQuery, cursor, limit: 25 });
      if (requestId !== directoryRequestRef.current) return;
      setStudents((current) => cursor ? [...current, ...page.items] : page.items);
      setStudentsCursor(page.nextCursor);
      setSelectedId((current) => {
        if (cursor) return current;
        if (current && page.items.some((row) => row.id === current)) return current;
        return page.items[0]?.id ?? null;
      });
    } catch (loadError) {
      if (requestId === directoryRequestRef.current && !background) {
        setError(userFacingErrorMessage(loadError, "Unable to load students."));
      }
    } finally {
      if (requestId === directoryRequestRef.current) {
        setLoading(false);
        setLoadingMoreStudents(false);
      }
    }
  }, [deferredQuery, user?.accessToken, user?.role]);

  const loadStudent = useCallback(async (studentId: string) => {
    if (!user?.accessToken) return;
    const requestId = ++detailRequestRef.current;
    setLoadingDetail(true);
    setError("");
    try {
      const [nextSummary, reservations, receipts, schedule, restrictions, offenses] = await Promise.all([
        getOperationalStudentSummaryFromApi(user.accessToken, studentId),
        getOperationalStudentReservationsFromApi(user.accessToken, studentId, { limit: 20 }),
        getOperationalStudentReceiptsFromApi(user.accessToken, studentId, { limit: 20 }),
        getOperationalStudentScheduleHistoryFromApi(user.accessToken, studentId, { limit: 20 }),
        getOperationalStudentRestrictionsFromApi(user.accessToken, studentId, { limit: 20 }),
        getOperationalStudentOffensesFromApi(user.accessToken, studentId, { limit: 20 })
      ]);
      if (requestId !== detailRequestRef.current) return;
      setSummary(nextSummary);
      setPages({ reservations, receipts, schedule, restrictions, offenses });
    } catch (loadError) {
      if (requestId === detailRequestRef.current) {
        setError(userFacingErrorMessage(loadError, "Unable to load this student profile."));
        setSummary(null);
      }
    } finally {
      if (requestId === detailRequestRef.current) setLoadingDetail(false);
    }
  }, [user?.accessToken]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadDirectory(), 250);
    return () => window.clearTimeout(timeout);
  }, [loadDirectory]);

  useEffect(() => {
    if (selectedId) void loadStudent(selectedId);
    else setSummary(null);
  }, [loadStudent, selectedId]);

  useRealtimeRefresh(["users", "reservations", "receipts"], () => {
    void loadDirectory({ background: true });
    if (selectedId) void loadStudent(selectedId);
  });

  const loadMoreDetail = async () => {
    if (!user?.accessToken || !selectedId) return;
    setLoadingMoreDetail(true);
    try {
      if (tab === "RESERVATIONS" && pages.reservations.nextCursor) {
        const next = await getOperationalStudentReservationsFromApi(user.accessToken, selectedId, { cursor: pages.reservations.nextCursor, limit: 20 });
        setPages((current) => ({ ...current, reservations: appendPage(current.reservations, next) }));
      } else if (tab === "RECEIPTS" && pages.receipts.nextCursor) {
        const next = await getOperationalStudentReceiptsFromApi(user.accessToken, selectedId, { cursor: pages.receipts.nextCursor, limit: 20 });
        setPages((current) => ({ ...current, receipts: appendPage(current.receipts, next) }));
      } else if (tab === "SCHEDULE" && pages.schedule.nextCursor) {
        const next = await getOperationalStudentScheduleHistoryFromApi(user.accessToken, selectedId, { cursor: pages.schedule.nextCursor, limit: 20 });
        setPages((current) => ({ ...current, schedule: appendPage(current.schedule, next) }));
      } else if (tab === "ACCESS") {
        const [restrictions, offenses] = await Promise.all([
          pages.restrictions.nextCursor
            ? getOperationalStudentRestrictionsFromApi(user.accessToken, selectedId, { cursor: pages.restrictions.nextCursor, limit: 20 })
            : Promise.resolve(null),
          pages.offenses.nextCursor
            ? getOperationalStudentOffensesFromApi(user.accessToken, selectedId, { cursor: pages.offenses.nextCursor, limit: 20 })
            : Promise.resolve(null)
        ]);
        setPages((current) => ({
          ...current,
          restrictions: restrictions ? appendPage(current.restrictions, restrictions) : current.restrictions,
          offenses: offenses ? appendPage(current.offenses, offenses) : current.offenses
        }));
      }
    } catch (loadError) {
      setError(userFacingErrorMessage(loadError, "Unable to load more student history."));
    } finally {
      setLoadingMoreDetail(false);
    }
  };

  const detailHasMore = tab === "RESERVATIONS" ? pages.reservations.nextCursor
    : tab === "RECEIPTS" ? pages.receipts.nextCursor
      : tab === "SCHEDULE" ? pages.schedule.nextCursor
        : tab === "ACCESS" ? pages.restrictions.nextCursor || pages.offenses.nextCursor
          : null;
  const routeBase = user?.role === "ADMIN" ? "/admin" : "/staff";

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Operations directory"
        title="Students"
        description="Find a student once, then review their reservations, receipts, pickup changes, and access history in one operational profile."
        action={<Button variant="secondary" onClick={() => void loadDirectory()} disabled={loading}><RefreshCw className="size-4" />Refresh</Button>}
      />
      {error ? <p role="alert" className="rounded-surface border border-danger/25 bg-danger/5 px-4 py-3 text-sm font-semibold text-danger">{error}</p> : null}

      <div className="grid min-h-[650px] gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
        <Surface className="overflow-hidden">
          <div className="border-b p-4">
            <label className="relative block">
              <span className="sr-only">Search students</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, ID, email, department" className="h-11 w-full rounded-control border bg-white pl-10 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/25" />
            </label>
          </div>
          <div className="max-h-[720px] overflow-y-auto">
            {loading ? <div className="p-5 text-sm font-semibold text-muted-foreground">Loading students...</div> : students.length ? students.map((student) => (
              <button key={student.id} type="button" onClick={() => { setSelectedId(student.id); setTab("PROFILE"); }} className={cn("w-full border-b p-4 text-left transition hover:bg-primary/5", selectedId === student.id && "bg-primary/10")}>
                <div className="flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 font-extrabold text-primary">{(student.fullName || student.email).slice(0, 1).toUpperCase()}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-extrabold text-foreground">{student.fullName || "Unnamed student"}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{student.studentNumber || student.email}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-bold text-muted-foreground">
                      <span>{student.reservationCount} reservations</span><span aria-hidden="true">·</span><span>{student.receiptCount} receipts</span>
                    </div>
                    {student.activeRestriction ? <div className="mt-2"><StatusBadge status="Restricted" /></div> : null}
                  </div>
                </div>
              </button>
            )) : <div className="p-6 text-center text-sm text-muted-foreground">No matching students found.</div>}
          </div>
          {studentsCursor ? <div className="border-t p-3"><Button variant="ghost" className="w-full" loading={loadingMoreStudents} onClick={() => void loadDirectory({ cursor: studentsCursor })}>Load more students</Button></div> : null}
        </Surface>

        {!selectedId ? (
          <FeedbackState kind="empty" title="Select a student" description="Choose a student from the directory to open their operational profile." />
        ) : loadingDetail || !summary ? (
          <FeedbackState kind="loading" title="Loading student profile" description="Collecting reservations, receipts, and operational history." />
        ) : (
          <Surface className="overflow-hidden">
            <header className="border-b bg-surface-subtle p-5 sm:p-6">
              <div className="flex flex-wrap items-start gap-4">
                <span className="grid size-14 shrink-0 place-items-center rounded-full bg-primary text-xl font-extrabold text-primary-foreground">{(summary.fullName || summary.email).slice(0, 1).toUpperCase()}</span>
                <div className="min-w-0 flex-1"><h2 className="text-2xl font-extrabold text-foreground">{summary.fullName || "Unnamed student"}</h2><p className="mt-1 text-sm text-muted-foreground">{summary.studentNumber || "No student number"} · {summary.department || "No department"}</p><p className="mt-0.5 text-sm text-muted-foreground">{summary.email}</p></div>
                {summary.activeRestriction ? <StatusBadge status="Restricted" /> : <StatusBadge status="Clear" />}
              </div>
            </header>
            <nav className="flex gap-1 overflow-x-auto border-b p-2" aria-label="Student record sections">
              {([
                ["PROFILE", "Profile", UserRound], ["RESERVATIONS", "Reservations", CalendarClock], ["RECEIPTS", "Receipts", ReceiptText], ["SCHEDULE", "Pickup history", History], ["ACCESS", "Access & offenses", ShieldAlert]
              ] as const).map(([value, label, Icon]) => (
                <button key={value} type="button" onClick={() => setTab(value)} className={cn("inline-flex min-h-10 shrink-0 items-center gap-2 rounded-control px-3 text-sm font-bold", tab === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}><Icon className="size-4" />{label}</button>
              ))}
            </nav>
            <div className="p-5 sm:p-6">
              {tab === "PROFILE" ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Surface className="bg-surface-subtle p-4"><p className="text-xs font-bold uppercase text-muted-foreground">Reservations</p><p className="mt-2 text-2xl font-extrabold">{Object.values(summary.reservationCounts).reduce((sum, count) => sum + (count ?? 0), 0)}</p></Surface>
                  <Surface className="bg-surface-subtle p-4"><p className="text-xs font-bold uppercase text-muted-foreground">Receipts</p><p className="mt-2 text-2xl font-extrabold">{summary.receiptCount}</p></Surface>
                  <Surface className="bg-surface-subtle p-4"><p className="text-xs font-bold uppercase text-muted-foreground">Pickup changes</p><p className="mt-2 text-2xl font-extrabold">{summary.scheduleChangeCount}</p></Surface>
                  <Surface className="bg-surface-subtle p-4"><p className="text-xs font-bold uppercase text-muted-foreground">Active offenses</p><p className="mt-2 text-2xl font-extrabold">{summary.activeOffenseCount}</p></Surface>
                  <div className="rounded-surface border p-4 sm:col-span-2 lg:col-span-4"><h3 className="font-extrabold">Account details</h3><dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="font-semibold text-muted-foreground">Joined</dt><dd className="mt-1 font-bold">{formatDate(summary.createdAt)}</dd></div><div><dt className="font-semibold text-muted-foreground">Last updated</dt><dd className="mt-1 font-bold">{formatDate(summary.updatedAt, true)}</dd></div></dl></div>
                </div>
              ) : null}
              {tab === "RESERVATIONS" ? <div className="space-y-3">{pages.reservations.items.length ? pages.reservations.items.map((reservation) => <article key={reservation.id} className="rounded-surface border p-4"><div className="flex flex-wrap justify-between gap-2"><div><p className="font-mono font-extrabold">{reservation.referenceCode}</p><p className="mt-1 text-xs text-muted-foreground">{formatDate(reservation.pickupStart, true)} · {reservation.items.reduce((sum, item) => sum + item.quantity, 0)} item(s)</p></div><div className="text-right"><StatusBadge statusKey={reservation.status} /><p className="mt-2 text-sm font-extrabold">{formatMoney(reservation.totalAmount)}</p></div></div></article>) : <p className="text-sm text-muted-foreground">No reservations found.</p>}</div> : null}
              {tab === "RECEIPTS" ? <div className="space-y-3">{pages.receipts.items.length ? pages.receipts.items.map((receipt) => <article key={receipt.id} className="rounded-surface border p-4"><div className="flex flex-wrap justify-between gap-2"><div><p className="font-mono font-extrabold">{receipt.receiptCode}</p><p className="mt-1 text-xs text-muted-foreground">{formatDate(receipt.issuedAt, true)} · {paymentMethodLabel(receipt.paymentMethod)}</p></div><div className="text-right"><StatusBadge statusKey={receipt.status} /><p className="mt-2 text-sm font-extrabold">{formatMoney(receipt.totalAmount)}</p></div></div></article>) : <p className="text-sm text-muted-foreground">No receipts found.</p>}</div> : null}
              {tab === "SCHEDULE" ? <div className="space-y-3">{pages.schedule.items.length ? pages.schedule.items.map((change) => <article key={change.id} className="rounded-surface border p-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-mono font-extrabold">{change.reservation.referenceCode}</p><StatusBadge status={change.source === "SYSTEM_CLOSURE" ? "Automatic closure move" : "Manual change"} /></div><p className="mt-2 text-sm"><span className="text-muted-foreground">From:</span> {formatDate(change.previousPickupStart, true)}</p><p className="mt-1 text-sm"><span className="text-muted-foreground">To:</span> {formatDate(change.newPickupStart, true)} · {change.newSlotLabel}</p><p className="mt-2 text-xs text-muted-foreground">{change.reason}</p></article>) : <p className="text-sm text-muted-foreground">No pickup schedule changes found.</p>}</div> : null}
              {tab === "ACCESS" ? <div className="space-y-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-extrabold">Restrictions and offenses</h3><p className="mt-1 text-sm text-muted-foreground">Operational history is read-only here.</p></div><Link href={`${routeBase}/student-access?studentId=${encodeURIComponent(selectedId)}`}><Button variant="secondary"><ShieldAlert className="size-4" />Manage access</Button></Link></div><section><h4 className="text-sm font-extrabold uppercase tracking-wide text-muted-foreground">Restrictions</h4><div className="mt-2 space-y-2">{pages.restrictions.items.length ? pages.restrictions.items.map((restriction) => <article key={restriction.id} className="rounded-surface border p-3"><div className="flex justify-between gap-2"><p className="font-bold">Level {restriction.level} · {restriction.source.toLowerCase()}</p><StatusBadge statusKey={restriction.status} /></div><p className="mt-1 text-sm text-muted-foreground">{restriction.reason}</p><p className="mt-2 text-xs text-muted-foreground">{formatDate(restriction.startsAt, true)} to {formatDate(restriction.endsAt, true)}</p></article>) : <p className="text-sm text-muted-foreground">No restriction history.</p>}</div></section><section><h4 className="text-sm font-extrabold uppercase tracking-wide text-muted-foreground">Offenses</h4><div className="mt-2 space-y-2">{pages.offenses.items.length ? pages.offenses.items.map((offense) => <article key={offense.id} className="rounded-surface border p-3"><div className="flex justify-between gap-2"><p className="font-bold">{offense.type.replaceAll("_", " ")}</p><StatusBadge status={offense.status === "ACTIVE" ? "Open" : "Overturned"} /></div><p className="mt-1 text-sm text-muted-foreground">{offense.reason}</p><p className="mt-2 text-xs text-muted-foreground">{formatDate(offense.occurredAt, true)}{offense.reservation ? ` · ${offense.reservation.referenceCode}` : ""}</p></article>) : <p className="text-sm text-muted-foreground">No offense history.</p>}</div></section></div> : null}
              {detailHasMore ? <div className="mt-5 flex justify-center"><Button variant="secondary" loading={loadingMoreDetail} onClick={() => void loadMoreDetail()}>Load more history</Button></div> : null}
            </div>
          </Surface>
        )}
      </div>
    </div>
  );
}
