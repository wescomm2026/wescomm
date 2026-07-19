"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Clock3 } from "lucide-react";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import { AssetIcon } from "@/components/ui/AssetIcon";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { getReservationsFromApi, type BackendReservation, type BackendReservationStatus } from "@/lib/api";
import { resolveShopProductAsset } from "@/lib/shop-assets";

type StoredReservationItem = {
  id: string;
  name: string;
  image: string;
  category: string;
  quantity: number;
  subtotal: string;
  details: string;
};

type StoredReservation = {
  id: string;
  reference: string;
  items: StoredReservationItem[];
  total: string;
  pickupDate: string | null;
  pickupTime: string | null;
  paymentMethod: string;
  notes: string;
  status: ReservationStatus;
  createdAt: string;
};

type ReservationStatus = "Pending" | "Confirmed" | "Ready for Pickup" | "Completed" | "Cancelled" | "No-show";
type ReservationFilter = "All" | ReservationStatus;

const reservationFilters: readonly ReservationFilter[] = [
  "All",
  "Pending",
  "Confirmed",
  "Ready for Pickup",
  "Completed",
  "Cancelled",
  "No-show"
];

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-PH", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric"
      });
}

function formatCreatedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

function formatMoney(value: string | number) {
  const numericValue = Number(value);
  return `PHP ${numericValue.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatBackendStatus(status: BackendReservationStatus): ReservationStatus {
  const labels: Record<BackendReservationStatus, ReservationStatus> = {
    PENDING: "Pending",
    CONFIRMED: "Confirmed",
    READY_FOR_PICKUP: "Ready for Pickup",
    COMPLETED: "Completed",
    CANCELLED: "Cancelled",
    NO_SHOW: "No-show"
  };

  return labels[status];
}

function reservationGuidance(status: ReservationStatus) {
  if (status === "Pending") {
    return {
      title: "Waiting for staff confirmation",
      detail: "Your item is held while commissary staff reviews the reservation."
    };
  }
  if (status === "Confirmed") {
    return {
      title: "Reservation confirmed",
      detail: "Staff confirmed the request. Wait for the ready-for-pickup update before visiting."
    };
  }
  if (status === "Ready for Pickup") {
    return {
      title: "Ready for pick-up",
      detail: "Bring your reference code and complete payment at the commissary during the pickup window."
    };
  }
  if (status === "Completed") {
    return {
      title: "Reservation completed",
      detail: "Your digital receipt will appear in the receipts page after staff generates or verifies it."
    };
  }
  if (status === "Cancelled") {
    return {
      title: "Reservation cancelled",
      detail: "The held stock was returned to available inventory."
    };
  }
  if (status === "No-show") {
    return {
      title: "Pickup window was missed",
      detail: "Staff confirmed that this reservation was not collected after the pickup window and grace period. Contact Support if this record needs review."
    };
  }

  return {
    title: "Reservation update",
    detail: "Check this page for the latest commissary status."
  };
}

function formatBackendPayment(value: string) {
  if (value === "E_WALLET_AT_PICKUP") return "E-wallet at Pickup";
  if (value === "GCASH") return "GCash";
  if (value === "CASH") return "Cash";
  return "Pay at Commissary";
}

function formatBackendTimeRange(startValue: string | null, endValue: string | null) {
  if (!startValue || !endValue) return null;
  const options: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Manila"
  };
  const start = new Date(startValue).toLocaleTimeString("en-PH", options);
  const end = new Date(endValue).toLocaleTimeString("en-PH", options);

  return `${start} - ${end}`;
}

function mapBackendReservations(rows: BackendReservation[]): StoredReservation[] {
  return rows.map((reservation) => ({
    id: reservation.id,
    reference: reservation.referenceCode,
    items: reservation.items.map((item) => {
      const productName = item.product?.name ?? "Campus Item";
      const asset = resolveShopProductAsset(productName, item.product?.imageUrl);

      return {
        id: item.id,
        name: asset.name,
        image: asset.image,
        category: item.product?.category?.name ?? "Campus Item",
        quantity: item.quantity,
        subtotal: formatMoney(item.subtotal),
        details: item.variantSummary ?? ""
      };
    }),
    total: formatMoney(reservation.totalAmount),
    pickupDate: reservation.pickupStart?.slice(0, 10) ?? null,
    pickupTime: formatBackendTimeRange(reservation.pickupStart, reservation.pickupEnd),
    paymentMethod: formatBackendPayment(reservation.paymentMethod),
    notes: reservation.staffNotes?.trim() ?? "",
    status: formatBackendStatus(reservation.status),
    createdAt: reservation.createdAt
  }));
}

function getPickupLabel(value: string) {
  const pickup = new Date(`${value}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const difference = Math.round((pickup.getTime() - today.getTime()) / 86400000);

  if (difference === 0) return "Pickup today";
  if (difference === 1) return "Pickup tomorrow";
  if (difference > 1) return `Pickup in ${difference} days`;
  return "Pickup schedule";
}

function ReservationCard({ reservation }: { reservation: StoredReservation }) {
  const guidance = reservationGuidance(reservation.status);
  const totalQuantity = reservation.items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <article className="overflow-hidden rounded-lg border border-[#dce5dd] bg-white shadow-sm transition hover:border-[#b8cfba] hover:shadow-[0_12px_30px_rgba(0,91,43,0.07)]">
      <header className="flex items-start gap-3 border-b border-[#e7ece8] p-4 sm:p-5">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase text-primary">Reservation reference</p>
          <h2 className="mt-1 break-all text-lg font-extrabold text-[#17211b]">{reservation.reference}</h2>
        </div>
        <StatusBadge status={reservation.status} />
      </header>

      {reservation.items.length ? (
        <ul className="divide-y divide-[#e7ece8]">
          {reservation.items.map((item) => (
            <li key={item.id} className="grid gap-4 p-4 sm:grid-cols-[96px_1fr] sm:p-5">
              <div className="relative mx-auto h-24 w-24 overflow-hidden rounded-lg bg-[#eff5ef] sm:mx-0">
                <Image src={item.image} alt={item.name} fill sizes="96px" className="object-contain p-2" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase text-primary">{item.category}</p>
                <h3 className="mt-1 text-base font-extrabold text-[#17211b]">{item.name}</h3>
                {item.details ? (
                  <div className="mt-3 rounded-md bg-[#f5f8f5] px-3 py-2">
                    <p className="text-xs font-bold uppercase text-[#68746d]">Selected item details</p>
                    <p className="mt-1 text-sm font-semibold text-primary">{item.details}</p>
                  </div>
                ) : null}
                <div className="mt-3 flex items-center justify-between gap-4 text-sm">
                  <span className="font-semibold text-[#68746d]">Quantity: {item.quantity}</span>
                  <span className="font-extrabold text-primary">{item.subtotal}</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="p-5 text-sm font-semibold text-[#68746d]">Reservation item details are unavailable.</p>
      )}

      <section className="mx-4 mb-4 mt-4 rounded-lg border border-[#bcd7bf] bg-[#edf7ee] p-4 sm:mx-5 sm:mb-5 sm:mt-5">
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-md bg-white">
            <AssetIcon src="/assets/pick-up.svg" className="size-8" />
          </span>
          <div className="min-w-0 flex-1">
            {reservation.pickupDate ? (
              <>
                <p className="text-xs font-extrabold uppercase text-primary">{getPickupLabel(reservation.pickupDate)}</p>
                <p className="mt-1 text-base font-extrabold text-[#17211b]">{formatDate(reservation.pickupDate)}</p>
                <p className="mt-1 flex items-center gap-2 text-sm font-semibold text-primary">
                  <Clock3 className="size-4" />
                  {reservation.pickupTime ?? "Pickup time to be confirmed"}
                </p>
              </>
            ) : (
              <>
                <p className="text-xs font-extrabold uppercase text-primary">Awaiting pickup schedule</p>
                <p className="mt-1 text-sm leading-6 text-[#5f6d64]">
                  Staff will post the approved pickup date and time here after confirmation.
                </p>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="mx-4 mb-4 rounded-lg border border-[#e0e8e1] bg-white p-4 sm:mx-5 sm:mb-5">
        <p className="text-sm font-extrabold text-[#17211b]">{guidance.title}</p>
        <p className="mt-1 text-sm leading-6 text-[#657169]">{guidance.detail}</p>
        {reservation.status === "Completed" ? (
          <Link href="/student/receipts" className="mt-3 inline-flex min-h-10 items-center rounded-md border border-[#bdd3c1] px-4 text-sm font-bold text-primary transition hover:bg-[#eef7ee]">
            View Receipts
          </Link>
        ) : null}
      </section>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-4 border-t border-[#e7ece8] px-4 py-4 text-sm sm:grid-cols-4 sm:px-5">
        <div>
          <dt className="text-xs font-semibold text-[#77817b]">Quantity</dt>
          <dd className="mt-1 font-extrabold text-[#26322b]">
            {totalQuantity} item{totalQuantity === 1 ? "" : "s"}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-[#77817b]">Payment</dt>
          <dd className="mt-1 font-bold text-[#26322b]">{reservation.paymentMethod}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-[#77817b]">Total</dt>
          <dd className="mt-1 font-extrabold text-primary">{reservation.total}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-[#77817b]">Reserved on</dt>
          <dd className="mt-1 font-bold text-[#26322b]">{formatCreatedAt(reservation.createdAt)}</dd>
        </div>
      </dl>

      {reservation.notes ? (
        <div className="border-t border-[#e7ece8] px-4 py-3 text-sm sm:px-5">
          <span className="font-bold text-[#536058]">Note: </span>
          <span className="text-[#667169]">{reservation.notes}</span>
        </div>
      ) : null}
    </article>
  );
}

export function StudentReservationsExperience() {
  const [savedReservations, setSavedReservations] = useState<StoredReservation[]>([]);
  const [reservationsOwnerId, setReservationsOwnerId] = useState("");
  const [activeFilter, setActiveFilter] = useState<ReservationFilter>("All");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const requestSequenceRef = useRef(0);
  const { user, ready: authReady, openAuth } = useStudentAuth();
  const accountId = user?.id ?? "";

  const loadReservations = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
    if (!authReady) return;
    const requestSequence = ++requestSequenceRef.current;

    if (!background) {
      setReady(false);
      setError("");
    }

    if (user?.accessToken && accountId) {
      try {
        const rows = await getReservationsFromApi(user.accessToken);
        if (requestSequence !== requestSequenceRef.current) return;
        setSavedReservations(mapBackendReservations(rows));
        setReservationsOwnerId(accountId);
      } catch (reservationError) {
        if (requestSequence === requestSequenceRef.current && !background) {
          setError(reservationError instanceof Error ? reservationError.message : "Unable to load reservations.");
          setSavedReservations([]);
        }
      } finally {
        if (requestSequence === requestSequenceRef.current && !background) setReady(true);
      }
      return;
    }

    setSavedReservations([]);
    setReservationsOwnerId(accountId);
    if (!background) setReady(true);
  }, [accountId, authReady, user?.accessToken]);

  useEffect(() => {
    setSavedReservations([]);
    setReservationsOwnerId(accountId);
    void loadReservations();
    return () => {
      requestSequenceRef.current += 1;
    };
  }, [accountId, loadReservations]);

  useEffect(() => {
    if (!authReady || !user?.accessToken) return;

    const refreshInBackground = () => {
      if (document.visibilityState === "visible") void loadReservations({ background: true });
    };

    const interval = window.setInterval(refreshInBackground, 12000);
    window.addEventListener("focus", refreshInBackground);
    document.addEventListener("visibilitychange", refreshInBackground);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshInBackground);
      document.removeEventListener("visibilitychange", refreshInBackground);
    };
  }, [accountId, authReady, loadReservations, user?.accessToken]);

  const reservations = useMemo(
    () => reservationsOwnerId === accountId ? savedReservations : [],
    [accountId, reservationsOwnerId, savedReservations]
  );

  const filteredReservations = useMemo(
    () => activeFilter === "All"
      ? reservations
      : reservations.filter((reservation) => reservation.status === activeFilter),
    [activeFilter, reservations]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase text-primary">Reservations</p>
          <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">My item reservations</h1>
          <p className="mt-2 text-sm text-[#657169]">Track confirmation status and see exactly when each item is ready for pickup.</p>
        </div>
        <Link href="/student/shop">
          <Button className="h-11 w-full sm:w-auto">
            <AssetIcon src="/assets/new-reserve.svg" className="size-6" />
            Reserve another item
          </Button>
        </Link>
      </div>

      {!authReady || !ready ? (
        <div className="h-64 animate-pulse rounded-lg border border-[#e0e7e1] bg-white" />
      ) : !user?.accessToken ? (
        <section className="rounded-lg border border-[#dce5dd] bg-white p-4 shadow-sm">
          <p className="text-sm leading-6 text-[#657169]">Log in with your Wesleyan account to view live reservation status from the commissary.</p>
          <Button type="button" onClick={openAuth} className="mt-4">Log in to view reservations</Button>
        </section>
      ) : reservations.length ? (
        <>
          {error ? <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p> : null}
          <section className="rounded-lg border border-[#cfe0d0] bg-[#f3f9f3] p-4">
            <div className="flex items-start gap-3">
              <CalendarDays className="mt-0.5 size-6 shrink-0 text-primary" />
              <div>
                <p className="font-bold text-[#203027]">Pickup information</p>
                <p className="mt-1 text-sm leading-6 text-[#5f6d64]">
                  Wait for staff confirmation before visiting the commissary. Ready reservations will show their approved pickup schedule.
                </p>
              </div>
            </div>
          </section>

          <section aria-labelledby="reservation-list-heading" className="space-y-4">
            <h2 id="reservation-list-heading" className="sr-only">Your reservations</h2>
            <div className="rounded-lg border border-[#dce5dd] bg-white p-2 shadow-sm sm:p-3">
              <div
                role="group"
                aria-label="Filter reservations by status"
                className="flex max-w-full gap-2 overflow-x-auto pb-1"
              >
                {reservationFilters.map((filter) => {
                  const selected = filter === activeFilter;

                  return (
                    <button
                      key={filter}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setActiveFilter(filter)}
                      className={`min-h-10 shrink-0 rounded-md px-4 text-sm font-bold transition focus:outline-none focus:ring-2 focus:ring-primary/30 ${
                        selected
                          ? "bg-primary text-white shadow-[0_6px_14px_rgba(0,91,43,0.18)]"
                          : "border border-[#d6e2d7] bg-white text-[#506057] hover:border-[#a9c6ac] hover:bg-[#f3f8f3]"
                      }`}
                    >
                      {filter}
                    </button>
                  );
                })}
              </div>
            </div>

            <p aria-live="polite" className="text-sm font-semibold text-[#657169]">
              Showing {filteredReservations.length} of {reservations.length} reservation{reservations.length === 1 ? "" : "s"}
            </p>

            {filteredReservations.length ? (
              <div className="grid gap-5 xl:grid-cols-2">
                {filteredReservations.map((reservation) => (
                  <ReservationCard key={reservation.id} reservation={reservation} />
                ))}
              </div>
            ) : (
              <div className="flex min-h-48 flex-col items-center justify-center rounded-lg border border-dashed border-[#cbd9cd] bg-white px-6 text-center">
                <h3 className="text-lg font-extrabold text-[#17211b]">No {activeFilter.toLowerCase()} reservations</h3>
                <p className="mt-2 max-w-md text-sm leading-6 text-[#657169]">
                  None of your reservations currently match this status. Choose another filter to see more.
                </p>
                <Button type="button" variant="secondary" className="mt-4" onClick={() => setActiveFilter("All")}>
                  Show all reservations
                </Button>
              </div>
            )}
          </section>
        </>
      ) : (
        <>
          {error ? <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p> : null}
          <section className="flex min-h-72 flex-col items-center justify-center rounded-lg border border-[#dce5dd] bg-white px-6 text-center shadow-sm">
            <span className="grid size-14 place-items-center rounded-full bg-[#e8f4e8] text-primary">
              <AssetIcon src="/assets/my-reservations.svg" className="size-10" />
            </span>
            <h2 className="mt-4 text-xl font-extrabold text-[#17211b]">No reservations yet</h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-[#657169]">
              Browse available campus essentials and use Buy Now to choose your item details and pickup schedule.
            </p>
            <Link href="/student/shop" className="mt-5">
              <Button>Browse Items</Button>
            </Link>
          </section>
        </>
      )}
    </div>
  );
}
