"use client";

import { userFacingErrorMessage } from "@/lib/user-facing-error";

import Link from "next/link";
import { useCallback, useDeferredValue, useEffect, useRef, useState } from "react";
import { Ban, CalendarClock, X } from "lucide-react";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import { useRealtimeRefresh } from "@/components/realtime/RealtimeProvider";
import { ActionLoadingOverlay } from "@/components/ui/ActionLoadingOverlay";
import { Button } from "@/components/ui/button";
import { useConfirmationDialog } from "@/components/ui/ConfirmationDialogProvider";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { PickupSchedulePicker, type PickupSelection } from "@/components/pickup/PickupSchedulePicker";
import { useAccessibleDialog } from "@/components/ui/useAccessibleDialog";
import {
  getReservationFromApi,
  getReservationPageFromApi,
  updateReservationStatusFromApi,
  rescheduleReservationFromApi,
  type BackendReservationStatus
} from "@/lib/api";
import { getStoredStaffSession } from "@/lib/staff-api";
import {
  mergeUniqueById,
  StaffReservationRow,
  backendReservationStatusFilter,
  reservationMatchesStaffSearch,
  mapStaffReservation,
  getNextReservationStatus,
  PageHeading,
  Toolbar,
  Notice
} from "@/components/staff/StaffOperationsShared";

export function StaffReservationsExperience() {
  const { user } = useStudentAuth();
  const confirm = useConfirmationDialog();
  const [rows, setRows] = useState<StaffReservationRow[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("All");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [submittingId, setSubmittingId] = useState("");
  const [rescheduleRow, setRescheduleRow] = useState<StaffReservationRow | null>(null);
  const [pickupSelection, setPickupSelection] = useState<PickupSelection | null>(null);
  const [rescheduleReason, setRescheduleReason] = useState("");
  const rescheduleDialog = useAccessibleDialog<HTMLElement>(Boolean(rescheduleRow), () => setRescheduleRow(null));
  const deferredSearch = useDeferredValue(search);
  const requestSequenceRef = useRef(0);
  const requestAbortRef = useRef<AbortController | null>(null);

  const loadReservations = useCallback(async ({
    background = false,
    cursor
  }: { background?: boolean; cursor?: string } = {}) => {
    const requestId = ++requestSequenceRef.current;
    requestAbortRef.current?.abort();
    const requestController = new AbortController();
    requestAbortRef.current = requestController;
    const session = getStoredStaffSession();
    if (!session.token) {
      setRows([]);
      setLoading(false);
      return;
    }

    if (cursor) setLoadingMore(true);
    else if (!background) {
      setLoading(true);
      setError("");
    }

    try {
      const page = await getReservationPageFromApi(session.token, {
        limit: 25,
        cursor,
        status: backendReservationStatusFilter(status),
        query: deferredSearch,
        signal: requestController.signal
      });
      if (requestId !== requestSequenceRef.current) return;
      const mappedReservations = page.items.map(mapStaffReservation);
      setRows((current) => {
        if (!cursor && !background) return mappedReservations;
        const source = cursor ? [...current, ...mappedReservations] : [...mappedReservations, ...current];
        return mergeUniqueById(source);
      });
      setNextCursor(page.nextCursor);
      const reservationId = new URL(window.location.href).searchParams.get("reservationId");
      const reservationQuery = new URL(window.location.href).searchParams.get("query");
      const targetedReservation = mappedReservations.find((reservation) => reservation.id === reservationId);
      if (targetedReservation) setSearch(targetedReservation.reference);
      else if (reservationQuery) setSearch(reservationQuery);
    } catch (reservationError) {
      if (requestId === requestSequenceRef.current && !background) {
        setError(userFacingErrorMessage(reservationError, "Unable to load reservations."));
      }
    } finally {
      if (requestId === requestSequenceRef.current) {
        if (cursor) setLoadingMore(false);
        if (!background) setLoading(false);
      }
    }
  }, [deferredSearch, status]);

  useRealtimeRefresh(["reservations"], (update) => {
    const session = getStoredStaffSession();
    if (!session.token || !update.entityId) {
      void loadReservations({ background: true });
      return;
    }

    void getReservationFromApi(session.token, update.entityId)
      .then((reservation) => {
        const mappedReservation = mapStaffReservation(reservation);
        const statusFilter = backendReservationStatusFilter(status);
        const matchesStatus = !statusFilter || reservation.status === statusFilter;
        const matchesQuery = reservationMatchesStaffSearch(reservation, deferredSearch);
        const shouldShow = matchesStatus && matchesQuery;

        setRows((current) => {
          const existingIndex = current.findIndex((item) => item.id === mappedReservation.id);
          if (!shouldShow) {
            return existingIndex >= 0
              ? current.filter((item) => item.id !== mappedReservation.id)
              : current;
          }
          if (existingIndex >= 0) {
            return current.map((item) => item.id === mappedReservation.id ? mappedReservation : item);
          }
          return [mappedReservation, ...current];
        });
      })
      .catch(() => loadReservations({ background: true }));
  });

  useEffect(() => {
    void loadReservations();
    return () => requestAbortRef.current?.abort();
  }, [loadReservations]);

  useEffect(() => {
    const refreshInBackground = () => {
      if (document.visibilityState === "visible") void loadReservations({ background: true });
    };

    const interval = window.setInterval(refreshInBackground, 5 * 60_000);
    window.addEventListener("focus", refreshInBackground);
    document.addEventListener("visibilitychange", refreshInBackground);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshInBackground);
      document.removeEventListener("visibilitychange", refreshInBackground);
    };
  }, [loadReservations]);

  const filtered = rows;

  const updateStatus = async (row: StaffReservationRow, nextStatus: BackendReservationStatus) => {
    const session = getStoredStaffSession();
    if (!session.token) return;

    const confirmation = nextStatus === "CANCELLED"
      ? {
          title: "Cancel this reservation?",
          description: `${row.reference} for ${row.student} will be cancelled and cannot continue through pickup. Existing payment and audit records will be retained.`,
          confirmLabel: "Cancel reservation",
          tone: "danger" as const
        }
      : nextStatus === "COMPLETED"
        ? {
            title: "Complete this reservation?",
            description: `${row.reference} will be recorded as released to ${row.student}, and its official receipt will be generated.`,
            confirmLabel: "Complete reservation",
            tone: "warning" as const
          }
        : nextStatus === "READY_FOR_PICKUP"
          ? {
              title: "Mark this reservation ready?",
              description: `${row.reference} will move to Ready for Pick-up so ${row.student} can proceed with collection.`,
              confirmLabel: "Mark ready",
              tone: "default" as const
            }
          : {
              title: "Confirm this reservation?",
              description: `${row.reference} will move from Pending to Confirmed and enter the staff preparation workflow.`,
              confirmLabel: "Confirm reservation",
              tone: "default" as const
            };
    const confirmed = await confirm(confirmation);
    if (!confirmed) return;

    setSubmittingId(row.id);
    setError("");

    try {
      const result = await updateReservationStatusFromApi(session.token, row.id, nextStatus);
      const mappedReservation = mapStaffReservation(result.reservation);
      setRows((current) => current.map((item) => item.id === row.id ? mappedReservation : item));
      setNotice(result.receipt
        ? `${row.reference} completed. Receipt ${result.receipt.receiptCode} was generated for verification.`
        : `${row.reference} updated to ${mappedReservation.status}.`);
    } catch (reservationError) {
      setError(userFacingErrorMessage(reservationError, "Unable to update the reservation."));
    } finally {
      setSubmittingId("");
    }
  };

  const openReschedule = (row: StaffReservationRow) => {
    setRescheduleRow(row);
    setPickupSelection(null);
    setRescheduleReason(row.pickupReviewReason ? `Schedule review: ${row.pickupReviewReason}` : "");
    setError("");
  };

  const saveReschedule = async () => {
    if (!rescheduleRow || !pickupSelection || rescheduleReason.trim().length < 5) return;
    const session = getStoredStaffSession();
    if (!session.token) return;
    setSubmittingId(rescheduleRow.id);
    setError("");
    try {
      const reservation = await rescheduleReservationFromApi(session.token, rescheduleRow.id, {
        expectedScheduleRevision: rescheduleRow.scheduleRevision,
        ...pickupSelection,
        reason: rescheduleReason.trim()
      });
      const mapped = mapStaffReservation(reservation);
      setRows((current) => current.map((item) => item.id === mapped.id ? mapped : item));
      setRescheduleRow(null);
      setPickupSelection(null);
      setRescheduleReason("");
      setNotice(`${mapped.reference} pickup rescheduled. The student was notified and the previous schedule remains in history.`);
    } catch (rescheduleError) {
      setError(userFacingErrorMessage(rescheduleError, "Unable to reschedule pickup."));
    } finally {
      setSubmittingId("");
    }
  };

  return (
    <div className="relative space-y-5">
      <PageHeading
        eyebrow="Reservations"
        title="Reservation queue"
        detail="Confirm requests and prepare scheduled pickups from live student checkout data."
        action={<Button variant="secondary" onClick={() => void loadReservations()} disabled={loading || Boolean(submittingId)}>Refresh</Button>}
      />
      <Toolbar search={search} onSearch={setSearch} status={status} onStatus={setStatus} placeholder="Search reference, student, or item" statuses={["Pending", "Confirmed", "Ready for Pick-up", "Completed", "Cancelled", "No-show"]} />
      {error ? <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p> : null}
      <div className="grid gap-3">
        {loading ? (
          <div className="rounded-lg border border-[#dce5dd] bg-white p-6 text-sm font-semibold text-[#68746d] shadow-sm">Loading live reservations...</div>
        ) : filtered.length ? filtered.map((row) => {
          const nextStatus = getNextReservationStatus(row.backendStatus);
          const paymentBlocksProgress = row.onlineGcash && !row.paymentConfirmed;
          const noShowEligible = row.backendStatus === "READY_FOR_PICKUP" && Boolean(row.pickupEnd) && Date.now() >= new Date(row.pickupEnd!).getTime() + 24 * 60 * 60 * 1000;
          return (
            <article key={row.id} className="content-visibility-auto relative grid gap-4 overflow-hidden rounded-lg border border-[#dce5dd] bg-white p-4 shadow-sm lg:grid-cols-[1fr_1.2fr_1.2fr_1fr_auto_auto] lg:items-center">
              <ActionLoadingOverlay
                active={submittingId === row.id}
                title="Updating reservation"
                detail="We are saving the status and updating the reservation timeline."
              />
              <div><p className="font-extrabold">{row.reference}</p><p className="text-xs text-[#68746d]">{row.student}</p></div>
              <div><p className="text-sm font-bold">{row.item}</p><p className="text-xs text-[#68746d]">Quantity: {row.quantity}</p></div>
              <div><p className="text-sm"><span className="font-bold text-primary">Pickup:</span> {row.pickup}</p>{row.pickupReviewStatus === "NEEDS_REVIEW" ? <p className="mt-1 text-xs font-bold text-amber-800">Needs review: {row.pickupReviewReason}</p> : null}</div>
              <div className="text-sm">
                <p><span className="font-bold text-primary">Payment:</span> {row.payment}</p>
                {row.onlineGcash ? <span className="mt-1 inline-flex"><StatusBadge status={row.paymentStatus} /></span> : null}
                <span className="mt-1 block font-extrabold text-[#17211b]">PHP {row.total.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              <StatusBadge status={row.status} />
              <div className="flex flex-wrap gap-2">
                {nextStatus ? (
                  <Button
                    className="h-10"
                    disabled={Boolean(submittingId) || paymentBlocksProgress}
                    title={paymentBlocksProgress ? "Wait for secure PayMongo payment confirmation before processing this reservation." : undefined}
                    onClick={() => void updateStatus(row, nextStatus)}
                  >
                    {submittingId === row.id
                      ? "Saving..."
                      : row.backendStatus === "PENDING"
                        ? "Confirm"
                        : row.backendStatus === "CONFIRMED"
                          ? "Mark ready"
                          : "Complete"}
                  </Button>
                ) : null}
                {paymentBlocksProgress ? (
                  <p className="max-w-48 text-xs font-semibold leading-5 text-amber-800">
                    Await secure payment confirmation. Do not use a screenshot as proof.
                  </p>
                ) : null}
                {noShowEligible ? (
                  <Link href={user?.role === "ADMIN" ? "/admin/students" : "/staff/students"}>
                    <Button variant="secondary" className="h-10 border-amber-300 text-amber-800 hover:bg-amber-50">
                      <Ban className="size-4" /> Review no-show
                    </Button>
                  </Link>
                ) : null}
                {row.backendStatus !== "COMPLETED" && row.backendStatus !== "CANCELLED" && row.backendStatus !== "NO_SHOW" ? (
                  <Button variant="secondary" className="h-10" disabled={Boolean(submittingId)} onClick={() => openReschedule(row)}>
                    <CalendarClock className="size-4" />{row.pickupReviewStatus === "NEEDS_REVIEW" ? "Review schedule" : "Reschedule"}
                  </Button>
                ) : null}
                {row.backendStatus !== "COMPLETED" && row.backendStatus !== "CANCELLED" && row.backendStatus !== "NO_SHOW" ? (
                  <Button variant="ghost" className="h-10 text-red-600" disabled={Boolean(submittingId)} onClick={() => void updateStatus(row, "CANCELLED")}>
                    Cancel
                  </Button>
                ) : null}
              </div>
            </article>
          );
        }) : (
          <div className="rounded-lg border border-[#dce5dd] bg-white p-6 text-sm font-semibold text-[#68746d] shadow-sm">No matching reservations found.</div>
        )}
      </div>
      {nextCursor ? (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="secondary"
            disabled={loadingMore}
            onClick={() => void loadReservations({ cursor: nextCursor })}
          >
            {loadingMore ? "Loading more..." : "Load more reservations"}
          </Button>
        </div>
      ) : null}
      {notice ? <Notice text={notice} onClose={() => setNotice("")} /> : null}
      {rescheduleRow ? (
        <div className="fixed inset-0 z-[10000] grid place-items-center overflow-y-auto bg-[#101820]/55 p-3" onMouseDown={(event) => { if (!submittingId && event.target === event.currentTarget) setRescheduleRow(null); }}>
          <section ref={rescheduleDialog.dialogRef} {...rescheduleDialog.dialogProps} className="relative my-4 w-full max-w-4xl overflow-hidden rounded-lg bg-white shadow-2xl">
            <ActionLoadingOverlay active={submittingId === rescheduleRow.id} title="Rescheduling pickup" detail="Saving the schedule history and notifying the student." />
            <header className="flex items-start gap-3 border-b border-[#e3eae4] p-5 sm:p-6">
              <span className="grid size-11 shrink-0 place-items-center rounded-md bg-[#e8f4e8] text-primary"><CalendarClock className="size-6" /></span>
              <div><p className="text-xs font-bold uppercase text-primary">Authorized schedule change</p><h2 id={rescheduleDialog.titleId} className="mt-1 text-xl font-extrabold text-[#17211b]">Reschedule {rescheduleRow.reference}</h2><p className="mt-1 text-sm text-[#68746d]">Current: {rescheduleRow.pickup} · revision {rescheduleRow.scheduleRevision}</p></div>
              <button type="button" data-dialog-autofocus aria-label="Close reschedule dialog" onClick={() => setRescheduleRow(null)} disabled={Boolean(submittingId)} className="ml-auto grid size-10 place-items-center rounded-md hover:bg-[#f1f5f1]"><X className="size-5" /></button>
            </header>
            <div className="max-h-[calc(100svh-190px)] space-y-5 overflow-y-auto p-5 sm:p-6">
              {rescheduleRow.pickupReviewReason ? <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">Review reason: {rescheduleRow.pickupReviewReason}</p> : null}
              <PickupSchedulePicker selection={pickupSelection} onChange={setPickupSelection} disabled={Boolean(submittingId)} initialDate={rescheduleRow.reservation.pickupStart?.slice(0, 10)} title="Choose the new pickup date" />
              <label className="grid gap-1.5 text-sm font-bold">Reason for rescheduling<textarea required minLength={5} maxLength={500} value={rescheduleReason} onChange={(event) => setRescheduleReason(event.target.value)} className="min-h-24 rounded-md border border-[#d3ddd4] px-3 py-2 font-normal outline-none focus:border-primary" placeholder="Explain the student-approved or operational reason." /></label>
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><Button variant="secondary" onClick={() => setRescheduleRow(null)} disabled={Boolean(submittingId)}>Cancel</Button><Button onClick={() => void saveReschedule()} disabled={Boolean(submittingId) || !pickupSelection || rescheduleReason.trim().length < 5}>Save and notify student</Button></div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
