"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  Ban,
  CheckCircle2,
  ChevronDown,
  Clock3,
  RefreshCw,
  Search,
  ShieldAlert,
  TriangleAlert,
  Unlock,
  UserRoundCheck,
  X
} from "lucide-react";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import { useRealtimeRefresh } from "@/components/realtime/RealtimeProvider";
import { ActionLoadingOverlay } from "@/components/ui/ActionLoadingOverlay";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  confirmReservationNoShowFromApi,
  createStudentRestrictionFromApi,
  getNoShowCandidatesFromApi,
  getRestrictionOverviewFromApi,
  liftStudentRestrictionFromApi,
  overturnStudentOffenseFromApi,
  type BackendNoShowCandidate,
  type BackendNoShowPage,
  type BackendRestrictionOverview,
  type BackendRestrictionStudent,
  type BackendStudentOffense
} from "@/lib/api";

type Duration = "7_DAYS" | "30_DAYS" | "INDEFINITE";

function formatDateTime(value: string | null) {
  if (!value) return "Pending administrator review";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Manila"
  }).format(date);
}

function studentName(student: BackendRestrictionStudent) {
  return student.fullName || student.email;
}

function restrictionStatus(student: BackendRestrictionStudent) {
  if (student.activeRestriction) return "Restricted";
  if (student.consecutiveOffenses > 0) return "Warning";
  return "Clear";
}

function durationLabel(duration: Duration) {
  if (duration === "7_DAYS") return "7 days";
  if (duration === "30_DAYS") return "30 days";
  return "Until admin review";
}

export function StaffRestrictionManagement({ role }: { role: "STAFF" | "ADMIN" }) {
  const { user } = useStudentAuth();
  const [overview, setOverview] = useState<BackendRestrictionOverview | null>(null);
  const [noShowPage, setNoShowPage] = useState<BackendNoShowPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingNoShows, setLoadingNoShows] = useState(true);
  const [loadingMoreStudents, setLoadingMoreStudents] = useState(false);
  const [loadingMoreNoShows, setLoadingMoreNoShows] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState("");
  const [noShowSearch, setNoShowSearch] = useState("");
  const [status, setStatus] = useState<"ALL" | "RESTRICTED" | "CLEAR">("ALL");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedStudent, setSelectedStudent] = useState<BackendRestrictionStudent | null>(null);
  const [noShowCandidate, setNoShowCandidate] = useState<BackendNoShowCandidate | null>(null);
  const [offenseToOverturn, setOffenseToOverturn] = useState<BackendStudentOffense | null>(null);
  const [duration, setDuration] = useState<Duration>("7_DAYS");
  const [reason, setReason] = useState("");

  const loadOverview = useCallback(async ({
    background = false,
    cursor
  }: { background?: boolean; cursor?: string } = {}) => {
    if (!user?.accessToken || (user.role !== "STAFF" && user.role !== "ADMIN")) return;
    if (cursor) setLoadingMoreStudents(true);
    else if (!background) setLoading(true);

    try {
      const next = await getRestrictionOverviewFromApi(user.accessToken, {
        query: search,
        status,
        cursor,
        limit: 25
      });
      setOverview((current) => cursor && current
        ? { ...next, students: [...current.students, ...next.students] }
        : next);
      setError("");
    } catch (requestError) {
      if (!background) setError(requestError instanceof Error ? requestError.message : "Unable to load student access records.");
    } finally {
      if (!background) setLoading(false);
      setLoadingMoreStudents(false);
    }
  }, [search, status, user?.accessToken, user?.role]);

  const loadNoShows = useCallback(async ({
    background = false,
    cursor
  }: { background?: boolean; cursor?: string } = {}) => {
    if (!user?.accessToken || (user.role !== "STAFF" && user.role !== "ADMIN")) return;
    if (cursor) setLoadingMoreNoShows(true);
    else if (!background) setLoadingNoShows(true);

    try {
      const next = await getNoShowCandidatesFromApi(user.accessToken, {
        query: noShowSearch,
        cursor,
        limit: 20
      });
      setNoShowPage((current) => cursor && current
        ? { ...next, items: [...current.items, ...next.items] }
        : next);
      setError("");
    } catch (requestError) {
      if (!background) setError(requestError instanceof Error ? requestError.message : "Unable to load eligible no-show reviews.");
    } finally {
      if (!background) setLoadingNoShows(false);
      setLoadingMoreNoShows(false);
    }
  }, [noShowSearch, user?.accessToken, user?.role]);

  useRealtimeRefresh(["restrictions", "reservations"], () => {
    void loadOverview({ background: true });
    void loadNoShows({ background: true });
  });

  useEffect(() => {
    const timer = window.setTimeout(() => void loadOverview(), 300);
    return () => window.clearTimeout(timer);
  }, [loadOverview]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadNoShows(), 300);
    return () => window.clearTimeout(timer);
  }, [loadNoShows]);

  useEffect(() => {
    if (!user?.accessToken) return undefined;
    const refresh = () => {
      if (document.visibilityState === "visible") {
        void loadOverview({ background: true });
        void loadNoShows({ background: true });
      }
    };
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loadNoShows, loadOverview, user?.accessToken]);

  const visibleStudents = overview?.students ?? [];
  const restrictedCount = overview?.summary.restrictedStudents ?? 0;
  const warningCount = overview?.summary.warningStudents ?? 0;

  const refreshAndReselect = async (studentId?: string) => {
    if (!user?.accessToken) return;
    const [next, nextNoShows] = await Promise.all([
      getRestrictionOverviewFromApi(user.accessToken, { query: search, status, limit: 25 }),
      getNoShowCandidatesFromApi(user.accessToken, { query: noShowSearch, limit: 20 })
    ]);
    setOverview(next);
    setNoShowPage(nextNoShows);
    if (studentId) setSelectedStudent(next.students.find((student) => student.id === studentId) ?? null);
  };

  const openStudent = (student: BackendRestrictionStudent) => {
    setSelectedStudent(student);
    setDuration("7_DAYS");
    setReason("");
    setOffenseToOverturn(null);
    setError("");
  };

  const applyRestriction = async (event: FormEvent) => {
    event.preventDefault();
    if (!user?.accessToken || !selectedStudent) return;
    setSubmitting(true);
    setError("");
    try {
      await createStudentRestrictionFromApi(user.accessToken, {
        studentId: selectedStudent.id,
        duration,
        reason
      });
      await refreshAndReselect(selectedStudent.id);
      setReason("");
      setNotice(`${studentName(selectedStudent)} can no longer submit reservations for ${durationLabel(duration).toLowerCase()}.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to apply the restriction.");
    } finally {
      setSubmitting(false);
    }
  };

  const liftRestriction = async (event: FormEvent) => {
    event.preventDefault();
    if (!user?.accessToken || !selectedStudent?.activeRestriction) return;
    setSubmitting(true);
    setError("");
    try {
      await liftStudentRestrictionFromApi(user.accessToken, selectedStudent.activeRestriction.id, reason);
      const studentId = selectedStudent.id;
      await refreshAndReselect(studentId);
      setReason("");
      setNotice(`${studentName(selectedStudent)} can submit reservations again.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to restore reservation access.");
    } finally {
      setSubmitting(false);
    }
  };

  const confirmNoShow = async () => {
    if (!user?.accessToken || !noShowCandidate) return;
    setSubmitting(true);
    setError("");
    try {
      const result = await confirmReservationNoShowFromApi(user.accessToken, noShowCandidate.id);
      await refreshAndReselect();
      const message = result.policyOutcome?.restriction
        ? `${noShowCandidate.referenceCode} was recorded as a no-show and reservation access was paused.`
        : `${noShowCandidate.referenceCode} was recorded as a no-show. The student received warning ${result.policyOutcome?.consecutiveOffenses ?? 1} of 3.`;
      setNotice(message);
      setNoShowCandidate(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to confirm this no-show.");
    } finally {
      setSubmitting(false);
    }
  };

  const overturnOffense = async (event: FormEvent) => {
    event.preventDefault();
    if (!user?.accessToken || !selectedStudent || !offenseToOverturn) return;
    setSubmitting(true);
    setError("");
    try {
      await overturnStudentOffenseFromApi(user.accessToken, offenseToOverturn.id, reason);
      await refreshAndReselect(selectedStudent.id);
      setNotice(`The offense for ${studentName(selectedStudent)} was removed after review.`);
      setOffenseToOverturn(null);
      setReason("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to remove this offense.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-bold uppercase text-primary">Student access</p>
          <h1 className="mt-1 text-3xl font-extrabold text-[#101820]">Reservation access review</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#68746d]">Review confirmed unclaimed reservations and pause only reservation access. Students keep access to receipts, support, and their account.</p>
        </div>
        <Button variant="secondary" onClick={() => { void loadOverview(); void loadNoShows(); }} disabled={loading || loadingNoShows}>
          <RefreshCw className={`size-4 ${loading || loadingNoShows ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </header>

      <section className="rounded-lg border border-[#cfe0d0] bg-[#f4faf4] p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 size-6 shrink-0 text-primary" />
          <div>
            <p className="font-extrabold text-[#203027]">Fair-use reservation policy</p>
            <p className="mt-1 text-sm leading-6 text-[#5f6d64]">Only staff-confirmed no-shows after the pickup deadline and 24-hour grace period count. The first two are warnings; the third pauses access for 7 days. Later repeated cases escalate to 30 days, then administrator review. A completed pickup resets the consecutive warning count.</p>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Student accounts", value: overview?.summary.totalStudents ?? 0, detail: "Available for review", icon: UserRoundCheck, tone: "bg-[#e8f4e8] text-primary" },
          { label: "Access paused", value: restrictedCount, detail: "Active reservation restrictions", icon: Ban, tone: "bg-[#fde8e8] text-[#a22b2b]" },
          { label: "Active warnings", value: warningCount, detail: "Before automatic suspension", icon: TriangleAlert, tone: "bg-[#fff0c7] text-[#8a5b00]" },
          { label: "No-shows to review", value: noShowPage?.totalCandidates ?? 0, detail: "Grace period already passed", icon: Clock3, tone: "bg-[#e9f1fb] text-[#245b8f]" }
        ].map((card) => (
          <article key={card.label} className="flex items-center gap-4 rounded-lg border border-[#dce5dd] bg-white p-4 shadow-sm">
            <span className={`grid size-12 shrink-0 place-items-center rounded-full ${card.tone}`}><card.icon className="size-6" /></span>
            <div><p className="text-sm font-bold text-[#4f5c54]">{card.label}</p><p className="mt-0.5 text-2xl font-extrabold text-[#17211b]">{card.value}</p><p className="text-xs text-[#738078]">{card.detail}</p></div>
          </article>
        ))}
      </section>

      {notice ? (
        <div className="flex items-start gap-3 rounded-lg border border-[#bcd9c0] bg-[#f1faf2] px-4 py-3 text-sm text-[#245c31]" role="status">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0" /><span className="font-semibold">{notice}</span>
          <button type="button" onClick={() => setNotice("")} aria-label="Dismiss message" className="ml-auto"><X className="size-4" /></button>
        </div>
      ) : null}
      {error ? <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700" role="alert">{error}</p> : null}

      <details className="overflow-hidden rounded-lg border border-[#dce5dd] bg-white shadow-sm">
        <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-4 sm:px-5">
          <span className="grid size-10 place-items-center rounded-md bg-[#fff0c7] text-[#8a5b00]"><Clock3 className="size-5" /></span>
          <div><p className="font-extrabold text-[#17211b]">Eligible no-show reviews</p><p className="text-xs text-[#68746d]">{noShowPage?.totalCandidates ?? 0} pickup{noShowPage?.totalCandidates === 1 ? "" : "s"} passed the grace period</p></div>
          <ChevronDown className="ml-auto size-5 text-primary" />
        </summary>
        <div className="border-t border-[#e7ece8] p-3 sm:p-4">
          <label className="mb-3 flex h-11 min-w-0 items-center rounded-md border border-[#d7e1d8] px-3 focus-within:border-primary">
            <Search className="mr-2 size-5 text-[#68746d]" />
            <input type="search" value={noShowSearch} onChange={(event) => setNoShowSearch(event.target.value)} placeholder="Search reference, student, or item" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
          </label>
          {loadingNoShows ? (
            <p className="px-2 py-5 text-sm font-semibold text-[#68746d]">Loading eligible no-show reviews...</p>
          ) : noShowPage?.items.length ? (
            <>
              <div className="grid gap-3 lg:grid-cols-2">
              {noShowPage.items.map((candidate) => (
                <article key={candidate.id} className="rounded-lg border border-[#e2e8e2] p-4">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1"><p className="font-extrabold text-[#17211b]">{candidate.referenceCode}</p><p className="mt-1 text-sm font-semibold text-primary">{candidate.student.fullName || candidate.student.email}</p><p className="text-xs text-[#68746d]">Pickup ended {formatDateTime(candidate.pickupEnd)}</p></div>
                    <Button variant="secondary" className="shrink-0 border-red-200 text-red-700 hover:bg-red-50" onClick={() => { setNoShowCandidate(candidate); setError(""); }}><Ban className="size-4" /> Review</Button>
                  </div>
                  <p className="mt-3 text-xs leading-5 text-[#68746d]">{candidate.items.map((item) => `${item.name} x${item.quantity}`).join(", ")}</p>
                </article>
              ))}
              </div>
              {noShowPage.nextCursor ? (
                <div className="mt-4 flex justify-center">
                  <Button variant="secondary" disabled={loadingMoreNoShows} onClick={() => void loadNoShows({ cursor: noShowPage.nextCursor ?? undefined })}>
                    {loadingMoreNoShows ? "Loading more..." : "Load more no-show reviews"}
                  </Button>
                </div>
              ) : null}
            </>
          ) : <p className="px-2 py-5 text-sm font-semibold text-[#68746d]">No reservations currently qualify for no-show review.</p>}
        </div>
      </details>

      <section className="overflow-hidden rounded-lg border border-[#dce5dd] bg-white shadow-sm">
        <div className="grid gap-3 border-b border-[#e6ece6] p-4 sm:grid-cols-[1fr_auto] sm:p-5">
          <label className="flex h-11 min-w-0 items-center rounded-md border border-[#d7e1d8] px-3 focus-within:border-primary">
            <Search className="mr-2 size-5 text-[#68746d]" />
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search student name, email, number, or department" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
          </label>
          <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} className="h-11 rounded-md border border-[#d7e1d8] bg-white px-3 text-sm font-semibold outline-none focus:border-primary">
            <option value="ALL">All students</option><option value="RESTRICTED">Access paused</option><option value="CLEAR">No active restriction</option>
          </select>
        </div>

        {loading ? (
          <div className="p-6 text-sm font-semibold text-[#68746d]">Loading student access records...</div>
        ) : visibleStudents.length ? (
          <>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="bg-[#f4f7f4] text-xs uppercase text-[#617068]"><tr><th className="px-5 py-3">Student</th><th className="px-5 py-3">Student number</th><th className="px-5 py-3">Warnings</th><th className="px-5 py-3">Reservation access</th><th className="px-5 py-3">Until</th><th className="px-5 py-3 text-right">Action</th></tr></thead>
                <tbody className="divide-y divide-[#e8ede9]">
                  {visibleStudents.map((student) => (
                    <tr key={student.id} className="hover:bg-[#fbfdfb]"><td className="px-5 py-4"><p className="font-extrabold text-[#17211b]">{studentName(student)}</p><p className="text-xs text-[#68746d]">{student.email}</p></td><td className="px-5 py-4">{student.studentNumber || "Not provided"}</td><td className="px-5 py-4 font-bold">{student.consecutiveOffenses} / {overview?.policy.firstRestrictionAt ?? 3}</td><td className="px-5 py-4"><StatusBadge status={restrictionStatus(student)} /></td><td className="px-5 py-4 text-[#5f6b64]">{student.activeRestriction ? formatDateTime(student.activeRestriction.endsAt) : "-"}</td><td className="px-5 py-4 text-right"><Button variant="secondary" onClick={() => openStudent(student)}>Manage</Button></td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid gap-3 p-3 lg:hidden">
              {visibleStudents.map((student) => (
                <article key={student.id} className="rounded-lg border border-[#e0e7e1] p-4">
                  <div className="flex items-start gap-3"><div className="min-w-0 flex-1"><p className="font-extrabold text-[#17211b]">{studentName(student)}</p><p className="truncate text-xs text-[#68746d]">{student.email}</p></div><StatusBadge status={restrictionStatus(student)} /></div>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-xs text-[#748078]">Student number</dt><dd className="mt-1 font-bold">{student.studentNumber || "Not provided"}</dd></div><div><dt className="text-xs text-[#748078]">Warnings</dt><dd className="mt-1 font-bold">{student.consecutiveOffenses} / {overview?.policy.firstRestrictionAt ?? 3}</dd></div></dl>
                  {student.activeRestriction ? <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">Paused until: {formatDateTime(student.activeRestriction.endsAt)}</p> : null}
                  <Button variant="secondary" className="mt-4 w-full" onClick={() => openStudent(student)}>Manage reservation access</Button>
                </article>
              ))}
            </div>
            {overview?.nextCursor ? (
              <div className="flex justify-center border-t border-[#e8ede9] p-4">
                <Button variant="secondary" disabled={loadingMoreStudents} onClick={() => void loadOverview({ cursor: overview.nextCursor ?? undefined })}>
                  {loadingMoreStudents ? "Loading more..." : "Load more students"}
                </Button>
              </div>
            ) : null}
          </>
        ) : <p className="p-6 text-sm font-semibold text-[#68746d]">No matching student accounts found.</p>}
      </section>

      {noShowCandidate ? (
        <div className="fixed inset-0 z-[10000] grid place-items-center overflow-y-auto bg-[#101820]/55 p-3" onMouseDown={(event) => { if (!submitting && event.target === event.currentTarget) setNoShowCandidate(null); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="no-show-title" className="relative w-full max-w-lg overflow-hidden rounded-lg border border-[#e0e6e0] bg-white p-5 shadow-2xl sm:p-6">
            <ActionLoadingOverlay
              active={submitting}
              title="Recording unclaimed pickup"
              detail="We are updating the reservation, stock, and student access record."
            />
            <div className="flex items-start gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-md bg-red-50 text-red-700"><TriangleAlert className="size-6" /></span><div><p className="text-xs font-bold uppercase text-red-700">Staff confirmation required</p><h2 id="no-show-title" className="mt-1 text-xl font-extrabold text-[#17211b]">Record this pickup as unclaimed?</h2></div><button type="button" onClick={() => setNoShowCandidate(null)} disabled={submitting} className="ml-auto grid size-9 place-items-center rounded-md hover:bg-[#f1f5f1] disabled:opacity-50" aria-label="Close"><X className="size-5" /></button></div>
            <div className="mt-5 rounded-lg border border-[#e2e8e2] bg-[#f8faf8] p-4 text-sm"><p className="font-extrabold">{noShowCandidate.referenceCode}</p><p className="mt-1 text-primary">{noShowCandidate.student.fullName || noShowCandidate.student.email}</p><p className="mt-2 text-[#68746d]">Pickup ended {formatDateTime(noShowCandidate.pickupEnd)}. The 24-hour grace period has passed.</p></div>
            <p className="mt-4 text-sm leading-6 text-[#5f6b64]">Use this only after checking that the student did not collect the items. It records an offense, returns held stock to inventory, and may trigger a reservation restriction.</p>
            <div className="mt-6 grid grid-cols-2 gap-3"><Button variant="secondary" onClick={() => setNoShowCandidate(null)} disabled={submitting}>Go back</Button><Button onClick={() => void confirmNoShow()} disabled={submitting} className="bg-red-700 hover:bg-red-800"><Ban className="size-4" />Confirm no-show</Button></div>
          </section>
        </div>
      ) : null}

      {selectedStudent ? (
        <div className="fixed inset-0 z-[9999] grid place-items-center overflow-y-auto bg-[#101820]/55 p-3" onMouseDown={(event) => { if (!submitting && event.target === event.currentTarget) setSelectedStudent(null); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="student-access-title" className="relative my-4 w-full max-w-2xl overflow-hidden rounded-lg border border-[#e0e6e0] bg-white shadow-2xl">
            <ActionLoadingOverlay
              active={submitting}
              title="Updating reservation access"
              detail="We are saving the review and refreshing the student's access."
            />
            <header className="flex items-start gap-3 border-b border-[#e7ece8] p-5 sm:p-6"><span className="grid size-11 shrink-0 place-items-center rounded-md bg-[#e8f4e8] text-primary">{selectedStudent.activeRestriction ? <Ban className="size-6" /> : <UserRoundCheck className="size-6" />}</span><div className="min-w-0"><p className="text-xs font-bold uppercase text-primary">Student reservation access</p><h2 id="student-access-title" className="mt-1 text-xl font-extrabold text-[#17211b]">{studentName(selectedStudent)}</h2><p className="truncate text-sm text-[#68746d]">{selectedStudent.email}</p></div><button type="button" onClick={() => setSelectedStudent(null)} disabled={submitting} aria-label="Close" className="ml-auto grid size-9 place-items-center rounded-md hover:bg-[#f1f5f1] disabled:opacity-50"><X className="size-5" /></button></header>
            <div className="max-h-[calc(100svh-170px)] space-y-5 overflow-y-auto p-5 sm:p-6">
              <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-md bg-[#f5f8f5] p-3"><p className="text-xs text-[#68746d]">Status</p><span className="mt-2 inline-block"><StatusBadge status={restrictionStatus(selectedStudent)} /></span></div><div className="rounded-md bg-[#f5f8f5] p-3"><p className="text-xs text-[#68746d]">Consecutive warnings</p><p className="mt-1 text-xl font-extrabold">{selectedStudent.consecutiveOffenses} / {overview?.policy.firstRestrictionAt ?? 3}</p></div><div className="rounded-md bg-[#f5f8f5] p-3"><p className="text-xs text-[#68746d]">Student number</p><p className="mt-1 font-extrabold">{selectedStudent.studentNumber || "Not provided"}</p></div></div>

              {offenseToOverturn ? (
                <form onSubmit={overturnOffense} className="rounded-lg border border-[#ead7a5] bg-[#fffaf0] p-4">
                  <p className="font-extrabold text-[#684900]">Remove this offense after review?</p><p className="mt-1 text-sm leading-6 text-[#685b3f]">{offenseToOverturn.reason}</p>
                  <label className="mt-4 grid gap-1.5 text-sm font-bold">Review reason<textarea required minLength={5} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} className="min-h-24 rounded-md border border-[#d9c998] bg-white px-3 py-2 font-normal outline-none focus:border-primary" placeholder="Explain why this record should be removed" /></label>
                  <div className="mt-4 flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => { setOffenseToOverturn(null); setReason(""); }} disabled={submitting}>Back</Button><Button type="submit" disabled={submitting}><Unlock className="size-4" />Remove offense</Button></div>
                </form>
              ) : selectedStudent.activeRestriction ? (
                <form onSubmit={liftRestriction} className="rounded-lg border border-[#e6b8b8] bg-[#fff7f7] p-4">
                  <p className="font-extrabold text-[#8f2222]">Reservation access is paused</p><p className="mt-1 text-sm leading-6 text-[#604747]">{selectedStudent.activeRestriction.reason}</p><p className="mt-2 text-xs font-semibold text-[#765454]">{selectedStudent.activeRestriction.endsAt ? `Scheduled to end ${formatDateTime(selectedStudent.activeRestriction.endsAt)}` : "Indefinite restriction pending administrator review"}</p>
                  <label className="mt-4 grid gap-1.5 text-sm font-bold">Reason for restoring access<textarea required minLength={5} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} className="min-h-24 rounded-md border border-[#dfbcbc] bg-white px-3 py-2 font-normal outline-none focus:border-primary" placeholder="Record why access is being restored" /></label>
                  <Button type="submit" disabled={submitting || (selectedStudent.activeRestriction.level === 3 && role !== "ADMIN")} className="mt-4"><Unlock className="size-4" />Restore reservation access</Button>
                  {selectedStudent.activeRestriction.level === 3 && role !== "ADMIN" ? <p className="mt-2 text-xs font-semibold text-red-700">An administrator must review and lift an indefinite restriction.</p> : null}
                </form>
              ) : (
                <form onSubmit={applyRestriction} className="rounded-lg border border-[#dce5dd] p-4">
                  <p className="font-extrabold text-[#17211b]">Pause reservation access manually</p><p className="mt-1 text-sm leading-6 text-[#68746d]">Use this for documented misuse that is not already handled by the automatic no-show policy.</p>
                  <fieldset className="mt-4"><legend className="text-sm font-bold">Duration</legend><div className={`mt-2 grid gap-2 ${role === "ADMIN" ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>{(["7_DAYS", "30_DAYS", ...(role === "ADMIN" ? ["INDEFINITE"] : [])] as Duration[]).map((option) => <button key={option} type="button" onClick={() => setDuration(option)} className={`min-h-11 rounded-md border px-3 text-sm font-bold ${duration === option ? "border-primary bg-[#eaf4ea] text-primary ring-1 ring-primary" : "border-[#d7e0d8] bg-white"}`}>{durationLabel(option)}</button>)}</div></fieldset>
                  <label className="mt-4 grid gap-1.5 text-sm font-bold">Documented reason<textarea required minLength={5} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} className="min-h-24 rounded-md border border-[#d7e0d8] px-3 py-2 font-normal outline-none focus:border-primary" placeholder="Explain the behavior and evidence reviewed" /></label>
                  <Button type="submit" disabled={submitting} className="mt-4"><Ban className="size-4" />Pause reservation access</Button>
                </form>
              )}

              <details className="rounded-lg border border-[#dce5dd]">
                <summary className="flex cursor-pointer list-none items-center px-4 py-3 font-extrabold text-[#17211b]">Offense history <span className="ml-2 rounded-full bg-[#edf4ed] px-2 text-xs leading-6 text-primary">{selectedStudent.offenses.length}</span><ChevronDown className="ml-auto size-4" /></summary>
                <div className="divide-y divide-[#e7ece8] border-t border-[#e7ece8]">
                  {selectedStudent.offenses.length ? selectedStudent.offenses.map((offense) => (
                    <div key={offense.id} className="p-4"><div className="flex items-start gap-3"><div className="min-w-0 flex-1"><p className="text-sm font-extrabold text-[#17211b]">{offense.type === "NO_SHOW" ? "Confirmed no-show" : "Reservation policy offense"}</p><p className="mt-1 text-xs text-[#68746d]">{offense.reservationReference || "Manual record"} - {formatDateTime(offense.occurredAt)}</p><p className="mt-2 text-sm leading-6 text-[#59665e]">{offense.reason}</p></div><StatusBadge status={offense.status === "ACTIVE" ? "Warning" : "Lifted"} /></div>{role === "ADMIN" && offense.status === "ACTIVE" ? <Button type="button" variant="secondary" className="mt-3" onClick={() => { setOffenseToOverturn(offense); setReason(""); }}><Unlock className="size-4" />Overturn after review</Button> : null}</div>
                  )) : <p className="p-4 text-sm text-[#68746d]">No recorded offenses.</p>}
                </div>
              </details>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
