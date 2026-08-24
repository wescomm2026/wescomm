"use client";

import Link from "next/link";
import { useCallback, useDeferredValue, useEffect, useRef, useState } from "react";
import { Ban } from "lucide-react";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import { useRealtimeRefresh } from "@/components/realtime/RealtimeProvider";
import { ActionLoadingOverlay } from "@/components/ui/ActionLoadingOverlay";
import { Button } from "@/components/ui/button";
import { useConfirmationDialog } from "@/components/ui/ConfirmationDialogProvider";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  getReservationFromApi,
  getReservationPageFromApi,
  updateReservationStatusFromApi,
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
        setError(reservationError instanceof Error ? reservationError.message : "Unable to load reservations.");
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
      setError(reservationError instanceof Error ? reservationError.message : "Unable to update reservation.");
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
              <p className="text-sm"><span className="font-bold text-primary">Pickup:</span> {row.pickup}</p>
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
                  <Link href={user?.role === "ADMIN" ? "/admin/student-access" : "/staff/student-access"}>
                    <Button variant="secondary" className="h-10 border-amber-300 text-amber-800 hover:bg-amber-50">
                      <Ban className="size-4" /> Review no-show
                    </Button>
                  </Link>
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
    </div>
  );
}
