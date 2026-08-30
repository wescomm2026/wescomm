"use client";

import { userFacingErrorMessage } from "@/lib/user-facing-error";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, CalendarDays, ChevronRight, Clock3, X, XCircle } from "lucide-react";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import { useRealtimeRefresh } from "@/components/realtime/RealtimeProvider";
import { AssetIcon } from "@/components/ui/AssetIcon";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  cancelMyReservationFromApi,
  createGcashCheckoutFromApi,
  getReservationFromApi,
  getReservationPageFromApi,
  type BackendPaymentMethod,
  type BackendPaymentStatus,
  type BackendPaymentSummary,
  type BackendReservation,
  type BackendReservationStatus
} from "@/lib/api";
import {
  mergeCursorPage,
  readServerState,
  reservationCacheKey,
  type CursorPage,
  upsertCursorItem,
  useServerState,
  writeServerState
} from "@/lib/server-state";
import {
  getPaymentIdempotencyKey,
  openTrustedPaymongoCheckout,
  rememberPaymentCheckout
} from "@/lib/payment-checkout";
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
  paymentMethod: BackendPaymentMethod;
  payment: BackendPaymentSummary | null;
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

function reservationGuidance(
  status: ReservationStatus,
  paymentMethod: BackendPaymentMethod,
  payment: BackendPaymentSummary | null
) {
  const isOnlineGcash = paymentMethod === "PAYMONGO_GCASH";
  const isPaidOnline = isOnlineGcash && payment?.status === "PAID";

  if (status === "Pending") {
    if (isPaidOnline) {
      return {
        title: "GCash payment confirmed",
        detail: "This paid reservation cannot be self-cancelled. Staff or an administrator must review the cancellation and refund first."
      };
    }
    return {
      title: isOnlineGcash ? "Online payment is not yet confirmed" : "Waiting for staff confirmation",
      detail: isOnlineGcash
        ? "Your reservation is saved. Complete or check the secure GCash payment below before staff processing."
        : "Your item is held while commissary staff reviews the reservation."
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
      detail: isPaidOnline
        ? "Your GCash payment is confirmed. Bring your reference code during the pickup window."
        : isOnlineGcash
          ? "Check the online payment status below before visiting the commissary."
          : "Bring your reference code and complete payment at the commissary during the pickup window."
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

function paymentRequiresStaffCancellation(
  paymentMethod: BackendPaymentMethod,
  payment: BackendPaymentSummary | null
) {
  return paymentMethod === "PAYMONGO_GCASH"
    && ["PAID", "REFUND_REVIEW_REQUIRED", "PARTIALLY_REFUNDED"].includes(payment?.status ?? "");
}

function formatBackendPayment(value: string) {
  if (value === "E_WALLET_AT_PICKUP") return "E-wallet at Pickup";
  if (value === "PAYMONGO_GCASH") return "GCash (Online)";
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
    paymentMethod: reservation.paymentMethod,
    payment: reservation.payment ?? null,
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

function paymentStatusDisplay(status?: BackendPaymentStatus) {
  if (status === "PAID") return "Paid";
  if (status === "AWAITING_PAYMENT") return "Awaiting payment";
  if (status === "INITIALIZING") return "Initializing";
  if (status === "REFUND_REVIEW_REQUIRED") return "Refund review required";
  if (status === "PARTIALLY_REFUNDED") return "Partially refunded";
  if (status === "REFUNDED") return "Refunded";
  if (status === "EXPIRED") return "Expired";
  if (status === "CANCELLED") return "Cancelled";
  return "Awaiting payment details";
}

function reservationPreviewAction(reservation: StoredReservation) {
  const canContinuePayment = reservation.paymentMethod === "PAYMONGO_GCASH"
    && reservation.payment?.status !== "PAID"
    && (reservation.payment ? reservation.payment.canResume || reservation.payment.canRetry : true);

  if (canContinuePayment) return "Continue payment";
  if (reservation.status === "Ready for Pickup") return "View pickup details";
  if (reservation.status === "Completed") return "View completed order";
  return "View details";
}

function ReservationPreviewCard({
  reservation,
  onOpen
}: {
  reservation: StoredReservation;
  onOpen: (trigger: HTMLButtonElement) => void;
}) {
  const firstItem = reservation.items[0] ?? null;
  const remainingLineItems = Math.max(0, reservation.items.length - 1);
  const totalQuantity = reservation.items.reduce((sum, item) => sum + item.quantity, 0);
  const isOnlineGcash = reservation.paymentMethod === "PAYMONGO_GCASH";

  return (
    <article
      data-testid="reservation-preview-card"
      className="overflow-hidden rounded-xl border border-[#dce5dd] bg-white shadow-sm transition hover:border-[#b8cfba] hover:shadow-[0_12px_30px_rgba(0,91,43,0.08)]"
    >
      <button
        type="button"
        onClick={(event) => onOpen(event.currentTarget)}
        aria-label={`View details for reservation ${reservation.reference}`}
        className="group block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[#e7ece8] px-4 py-3.5 sm:px-5">
          <div className="min-w-0">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-primary">Reservation</p>
            <p className="mt-1 break-all text-sm font-extrabold text-[#17211b]">{reservation.reference}</p>
            <p className="mt-1 text-xs font-semibold text-[#77817b]">Reserved {formatCreatedAt(reservation.createdAt)}</p>
          </div>
          <StatusBadge status={reservation.status} />
        </div>

        {firstItem ? (
          <div className="grid grid-cols-[76px_1fr] gap-3 px-4 py-4 sm:grid-cols-[88px_1fr] sm:px-5">
            <div className="relative size-[76px] overflow-hidden rounded-lg bg-[#eff5ef] sm:size-[88px]">
              <Image src={firstItem.image} alt={firstItem.name} fill sizes="88px" className="object-contain p-2" />
            </div>
            <div className="min-w-0 self-center">
              <p className="text-[11px] font-bold uppercase tracking-wide text-primary">{firstItem.category}</p>
              <h3 className="mt-1 line-clamp-2 text-base font-extrabold leading-snug text-[#17211b]">{firstItem.name}</h3>
              {firstItem.details ? (
                <p className="mt-1 truncate text-xs font-semibold text-[#657169]">{firstItem.details}</p>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold text-[#657169]">
                <span>Qty: {firstItem.quantity}</span>
                {remainingLineItems ? (
                  <span className="rounded-full bg-[#edf5ee] px-2 py-1 font-bold text-primary">
                    +{remainingLineItems} more item{remainingLineItems === 1 ? "" : "s"}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        ) : (
          <p className="px-4 py-5 text-sm font-semibold text-[#68746d] sm:px-5">Reservation item preview is unavailable.</p>
        )}

        <div className="mx-4 rounded-lg bg-[#f3f8f3] px-3 py-2.5 text-sm sm:mx-5">
          <div className="flex items-start gap-2.5">
            <Clock3 className="mt-0.5 size-4 shrink-0 text-primary" />
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-wide text-[#68746d]">Pickup</p>
              {reservation.pickupDate ? (
                <p className="mt-0.5 font-bold text-[#26322b]">
                  {formatDate(reservation.pickupDate)}
                  <span className="font-semibold text-[#68746d]"> · {reservation.pickupTime ?? "Time to be confirmed"}</span>
                </p>
              ) : (
                <p className="mt-0.5 font-bold text-[#526158]">Awaiting staff confirmation</p>
              )}
            </div>
          </div>
        </div>

        {isOnlineGcash ? (
          <div className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-lg border border-[#dce7dd] px-3 py-2 sm:mx-5">
            <span className="text-xs font-extrabold uppercase tracking-wide text-primary">GCash payment</span>
            <StatusBadge status={paymentStatusDisplay(reservation.payment?.status)} />
          </div>
        ) : null}

        <div className="mt-4 flex items-end justify-between gap-4 border-t border-[#e7ece8] px-4 py-3.5 sm:px-5">
          <div>
            <p className="text-xs font-semibold text-[#77817b]">{totalQuantity} item{totalQuantity === 1 ? "" : "s"} total</p>
            <p className="mt-0.5 text-lg font-extrabold text-primary">{reservation.total}</p>
          </div>
          <span className="inline-flex min-h-10 items-center gap-1 rounded-lg bg-[#eaf5eb] px-3 text-sm font-extrabold text-primary transition group-hover:bg-[#dceedd]">
            {reservationPreviewAction(reservation)}
            <ChevronRight className="size-4" />
          </span>
        </div>
      </button>
    </article>
  );
}

function ReservationDetailsModal({
  reservation,
  accessToken,
  onCancelled,
  onClose,
  returnFocusRef
}: {
  reservation: StoredReservation | null;
  accessToken: string;
  onCancelled: (reservation: BackendReservation) => void;
  onClose: () => void;
  returnFocusRef: RefObject<HTMLButtonElement>;
}) {
  const [mounted, setMounted] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const reservationIdentity = reservation?.id ?? null;

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!reservationIdentity) return;

    const returnFocusElement = returnFocusRef.current;
    const overlay = overlayRef.current;
    const backgroundElements = overlay
      ? Array.from(document.body.children).filter((element): element is HTMLElement => (
          element instanceof HTMLElement && element !== overlay
        ))
      : [];
    const previousBackgroundState = backgroundElements.map((element) => ({
      element,
      inert: element.hasAttribute("inert"),
      ariaHidden: element.getAttribute("aria-hidden")
    }));
    previousBackgroundState.forEach(({ element }) => {
      element.setAttribute("inert", "");
      element.setAttribute("aria-hidden", "true");
    });

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusableElements = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => element.getAttribute("aria-hidden") !== "true");
      const firstElement = focusableElements[0];
      const lastElement = focusableElements.at(-1);
      if (!firstElement || !lastElement) {
        event.preventDefault();
        return;
      }
      if (event.shiftKey && (document.activeElement === firstElement || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && (document.activeElement === lastElement || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      previousBackgroundState.forEach(({ element, inert, ariaHidden }) => {
        if (inert) element.setAttribute("inert", "");
        else element.removeAttribute("inert");
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      });
      window.requestAnimationFrame(() => {
        if (returnFocusElement?.isConnected) returnFocusElement.focus();
      });
    };
  }, [onClose, reservationIdentity, returnFocusRef]);

  if (!mounted || !reservation) return null;

  return createPortal(
    <div
      ref={overlayRef}
      role="presentation"
      className="fixed inset-0 z-[9000] flex items-end justify-center bg-[#101820]/55 backdrop-blur-[2px] sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Reservation details ${reservation.reference}`}
        className="flex h-[100svh] w-full flex-col overflow-hidden bg-[#f3f6f3] shadow-[0_30px_90px_rgba(0,0,0,0.3)] sm:max-h-[calc(100vh-3rem)] sm:max-w-[860px] sm:rounded-2xl sm:border sm:border-[#dce5dd]"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-[#dce5dd] bg-white px-4 py-3 sm:px-5">
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label={`Close reservation details ${reservation.reference}`}
            className="grid size-11 shrink-0 place-items-center rounded-full text-[#26322b] transition hover:bg-[#eef6ee] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <ArrowLeft className="size-6 sm:hidden" />
            <X className="hidden size-5 sm:block" />
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-extrabold text-[#17211b] sm:text-lg">Reservation details</h2>
            <p className="mt-0.5 truncate text-xs font-bold text-primary">{reservation.reference}</p>
          </div>
          <StatusBadge status={reservation.status} />
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:p-5">
          <ReservationDetails reservation={reservation} accessToken={accessToken} onCancelled={onCancelled} />
        </div>
      </section>
    </div>,
    document.body
  );
}

function ReservationDetails({
  reservation,
  accessToken,
  onCancelled
}: {
  reservation: StoredReservation;
  accessToken: string;
  onCancelled: (reservation: BackendReservation) => void;
}) {
  const guidance = reservationGuidance(reservation.status, reservation.paymentMethod, reservation.payment);
  const totalQuantity = reservation.items.reduce((sum, item) => sum + item.quantity, 0);
  const [paymentError, setPaymentError] = useState("");
  const [openingPayment, setOpeningPayment] = useState(false);
  const [confirmingCancellation, setConfirmingCancellation] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancellationError, setCancellationError] = useState("");
  const paymentErrorRef = useRef<HTMLParagraphElement | null>(null);
  const cancellationErrorRef = useRef<HTMLParagraphElement | null>(null);
  const isOnlineGcash = reservation.paymentMethod === "PAYMONGO_GCASH";
  const requiresStaffCancellation = paymentRequiresStaffCancellation(
    reservation.paymentMethod,
    reservation.payment
  );
  const canSelfCancel = reservation.status === "Pending" && !requiresStaffCancellation;
  const selfCancellationClosed = reservation.status === "Confirmed" || reservation.status === "Ready for Pickup";
  const canContinuePayment = isOnlineGcash
    && reservation.payment?.status !== "PAID"
    && (reservation.payment ? reservation.payment.canResume || reservation.payment.canRetry : true);

  useEffect(() => {
    if (paymentError) paymentErrorRef.current?.focus();
  }, [paymentError]);

  useEffect(() => {
    if (cancellationError) cancellationErrorRef.current?.focus();
  }, [cancellationError]);

  const continuePayment = async () => {
    if (!accessToken || !canContinuePayment) return;
    setOpeningPayment(true);
    setPaymentError("");
    try {
      const checkout = await createGcashCheckoutFromApi(
        accessToken,
        reservation.id,
        getPaymentIdempotencyKey(reservation.id, { renew: reservation.payment?.canRetry === true })
      );
      if (!rememberPaymentCheckout(checkout.payment, checkout.checkoutUrl)) {
        throw new Error("WESCOMM blocked an invalid payment destination. Please try again.");
      }
      openTrustedPaymongoCheckout(checkout.checkoutUrl);
    } catch (error) {
      setPaymentError(userFacingErrorMessage(error, "Unable to continue this payment."));
    } finally {
      setOpeningPayment(false);
    }
  };

  const cancelReservation = async () => {
    if (!accessToken || !canSelfCancel) return;
    setCancelling(true);
    setCancellationError("");

    try {
      const updatedReservation = await cancelMyReservationFromApi(accessToken, reservation.id);
      setConfirmingCancellation(false);
      onCancelled(updatedReservation);
    } catch (error) {
      setCancellationError(userFacingErrorMessage(error, "Unable to cancel this reservation."));
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-[#dce5dd] bg-white shadow-sm">
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

      {isOnlineGcash ? (
        <section className="mx-4 mb-4 rounded-lg border border-[#d8e5d9] bg-[#fbfdfb] p-4 sm:mx-5 sm:mb-5" aria-label="Online payment status">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-extrabold uppercase text-primary">PayMongo GCash</p>
              <p className="mt-1 text-sm font-bold text-[#17211b]">
                {reservation.payment?.status === "PAID"
                  ? "Payment confirmed by the secure server record"
                  : "Payment is separate from the reservation status"}
              </p>
            </div>
            <StatusBadge status={paymentStatusDisplay(reservation.payment?.status)} />
          </div>
          {reservation.payment?.providerReference ? (
            <p className="mt-3 break-all text-xs text-[#657169]">
              Payment reference: <strong>{reservation.payment.providerReference}</strong>
            </p>
          ) : null}
          {paymentError ? (
            <p ref={paymentErrorRef} tabIndex={-1} role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
              {paymentError}
            </p>
          ) : null}
          {canContinuePayment ? (
            <Button className="mt-3 min-h-11" onClick={() => void continuePayment()} disabled={openingPayment} aria-busy={openingPayment}>
              <AssetIcon src="/assets/e-wallet.svg" className="size-5" />
              {openingPayment
                ? "Opening GCash..."
                : reservation.payment?.canRetry ? "Try GCash Again" : "Continue GCash Payment"}
            </Button>
          ) : null}
        </section>
      ) : null}

      {canSelfCancel || requiresStaffCancellation || selfCancellationClosed ? (
        <section className="mx-4 mb-4 rounded-lg border border-[#eadfda] bg-[#fffaf8] p-4 sm:mx-5 sm:mb-5" aria-label="Reservation cancellation">
          {canSelfCancel ? (
            confirmingCancellation ? (
              <div>
                <p className="font-extrabold text-[#692f24]">Cancel this pending reservation?</p>
                <p className="mt-1 text-sm leading-6 text-[#765e58]">
                  The held stock will be released and this action cannot be undone.
                </p>
                {cancellationError ? (
                  <p ref={cancellationErrorRef} tabIndex={-1} role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
                    {cancellationError}
                  </p>
                ) : null}
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setConfirmingCancellation(false);
                      setCancellationError("");
                    }}
                    disabled={cancelling}
                  >
                    Keep Reservation
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="border border-red-200 text-red-700 hover:bg-red-50"
                    onClick={() => void cancelReservation()}
                    disabled={cancelling}
                    aria-busy={cancelling}
                  >
                    <XCircle className="size-4" />
                    {cancelling ? "Cancelling..." : "Confirm Cancellation"}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-extrabold text-[#422f29]">Need to cancel?</p>
                  <p className="mt-1 text-sm leading-6 text-[#765e58]">Students may cancel only while a reservation is pending.</p>
                </div>
                <Button type="button" variant="ghost" className="shrink-0 border border-red-200 text-red-700 hover:bg-red-50" onClick={() => setConfirmingCancellation(true)}>
                  <XCircle className="size-4" />
                  Cancel Reservation
                </Button>
              </div>
            )
          ) : requiresStaffCancellation ? (
            <div>
              <p className="font-extrabold text-[#692f24]">Staff review is required</p>
              <p className="mt-1 text-sm leading-6 text-[#765e58]">
                This pending reservation has a confirmed or refund-related GCash payment. Staff or an administrator must handle the cancellation and refund.
              </p>
              <Link href="/student/support" className="mt-3 inline-flex min-h-10 items-center rounded-md border border-[#dfc5bd] bg-white px-4 text-sm font-bold text-primary hover:bg-[#fff4ef] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
                Contact Support
              </Link>
            </div>
          ) : (
            <div>
              <p className="font-extrabold text-[#422f29]">Student cancellation is closed</p>
              <p className="mt-1 text-sm leading-6 text-[#765e58]">
                Confirmed and ready-for-pickup reservations can only be cancelled by authorized staff or an administrator when system rules allow.
              </p>
              <Link href="/student/support" className="mt-3 inline-flex min-h-10 items-center rounded-md border border-[#dfc5bd] bg-white px-4 text-sm font-bold text-primary hover:bg-[#fff4ef] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
                Request Assistance
              </Link>
            </div>
          )}
        </section>
      ) : null}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-4 border-t border-[#e7ece8] px-4 py-4 text-sm sm:grid-cols-4 sm:px-5">
        <div>
          <dt className="text-xs font-semibold text-[#77817b]">Quantity</dt>
          <dd className="mt-1 font-extrabold text-[#26322b]">
            {totalQuantity} item{totalQuantity === 1 ? "" : "s"}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-[#77817b]">Payment</dt>
          <dd className="mt-1 font-bold text-[#26322b]">{formatBackendPayment(reservation.paymentMethod)}</dd>
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
    </div>
  );
}

export function StudentReservationsExperience() {
  const [activeFilter, setActiveFilter] = useState<ReservationFilter>("All");
  const [ready, setReady] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [selectedReservationId, setSelectedReservationId] = useState<string | null>(null);
  const requestSequenceRef = useRef(0);
  const reservationTriggerRef = useRef<HTMLButtonElement | null>(null);
  const { user, ready: authReady, openAuth } = useStudentAuth();
  const accountId = user?.id ?? "";
  const cacheKey = reservationCacheKey(accountId);
  const reservationPage = useServerState<CursorPage<BackendReservation>>(cacheKey);

  const loadReservations = useCallback(async ({
    background = false,
    cursor
  }: { background?: boolean; cursor?: string } = {}) => {
    if (!authReady) return;
    const requestSequence = ++requestSequenceRef.current;

    if (cursor) setLoadingMore(true);
    else if (!background) {
      setReady(false);
      setError("");
    }

    if (user?.accessToken && accountId) {
      try {
        const page = await getReservationPageFromApi(user.accessToken, { limit: 20, cursor });
        if (requestSequence !== requestSequenceRef.current) return;
        writeServerState<CursorPage<BackendReservation>>(cacheKey, (current) =>
          mergeCursorPage(current, page, cursor ? "append" : background ? "prepend" : "replace")
        );
      } catch (reservationError) {
        if (requestSequence === requestSequenceRef.current && !background) {
          setError(userFacingErrorMessage(reservationError, "Unable to load reservations."));
        }
      } finally {
        if (requestSequence === requestSequenceRef.current && cursor) setLoadingMore(false);
        if (requestSequence === requestSequenceRef.current && !background) setReady(true);
      }
      return;
    }

    if (!background) setReady(true);
  }, [accountId, authReady, cacheKey, user?.accessToken]);

  useRealtimeRefresh(["reservations"], (update) => {
    if (!user?.accessToken || !update.entityId) {
      void loadReservations({ background: true });
      return;
    }

    void getReservationFromApi(user.accessToken, update.entityId)
      .then((reservation) => upsertCursorItem(cacheKey, reservation, true))
      .catch(() => loadReservations({ background: true }));
  });

  useEffect(() => {
    setSelectedReservationId(null);
    const cached = readServerState<CursorPage<BackendReservation>>(cacheKey);
    if (cached) {
      setReady(true);
      if (Date.now() - cached.updatedAt >= 5 * 60_000) void loadReservations({ background: true });
    } else {
      void loadReservations();
    }
    return () => {
      requestSequenceRef.current += 1;
    };
  }, [accountId, cacheKey, loadReservations]);

  useEffect(() => {
    if (!authReady || !user?.accessToken) return;

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
  }, [accountId, authReady, loadReservations, user?.accessToken]);

  const reservations = useMemo(() => mapBackendReservations(reservationPage?.items ?? []), [reservationPage]);

  const filteredReservations = useMemo(
    () => activeFilter === "All"
      ? reservations
      : reservations.filter((reservation) => reservation.status === activeFilter),
    [activeFilter, reservations]
  );

  const selectedReservation = selectedReservationId
    ? reservations.find((reservation) => reservation.id === selectedReservationId) ?? null
    : null;

  const openReservationDetails = useCallback((reservationId: string, trigger: HTMLButtonElement) => {
    reservationTriggerRef.current = trigger;
    setSelectedReservationId(reservationId);
  }, []);

  const closeReservationDetails = useCallback(() => setSelectedReservationId(null), []);

  const handleReservationCancelled = useCallback((updatedReservation: BackendReservation) => {
    const mappedReservation = mapBackendReservations([updatedReservation])[0];
    if (!mappedReservation) return;
    upsertCursorItem(cacheKey, updatedReservation);
  }, [cacheKey]);

  return (
    <>
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
                  <ReservationPreviewCard
                    key={reservation.id}
                    reservation={reservation}
                    onOpen={(trigger) => openReservationDetails(reservation.id, trigger)}
                  />
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
            {reservationPage?.nextCursor ? (
              <div className="flex justify-center pt-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={loadingMore}
                  onClick={() => void loadReservations({ cursor: reservationPage.nextCursor ?? undefined })}
                >
                  {loadingMore ? "Loading more..." : "Load more reservations"}
                </Button>
              </div>
            ) : null}
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
      <ReservationDetailsModal
        reservation={selectedReservation}
        accessToken={user?.accessToken ?? ""}
        onCancelled={handleReservationCancelled}
        onClose={closeReservationDetails}
        returnFocusRef={reservationTriggerRef}
      />
    </>
  );
}
