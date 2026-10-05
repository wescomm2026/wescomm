"use client";

import { userFacingErrorMessage } from "@/lib/user-facing-error";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import { Download, Eye, Search, ShieldCheck, X } from "lucide-react";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import { useRealtimeRefresh } from "@/components/realtime/RealtimeProvider";
import { AssetIcon } from "@/components/ui/AssetIcon";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { getReceiptFromApi, getReceiptPageFromApi, isRequestAbortError, type BackendReceipt, type BackendReceiptStatus } from "@/lib/api";
import { InlineAlert } from "@/components/ui/InlineAlert";
import { useStudentOverview } from "@/components/student/useStudentOverview";
import { cn } from "@/lib/utils";
import { downloadReceiptPng } from "@/components/receipts/receipt-png";
import { paymentMethodLabel } from "@/lib/payment-method";
import { collectionChannelLabel } from "@/lib/collection-channel";
import {
  mergeCursorPage,
  readServerState,
  receiptCacheKey,
  type CursorPage,
  upsertCursorItem,
  useServerState,
  writeServerState
} from "@/lib/server-state";

type Receipt = {
  id: string;
  code: string;
  student: string;
  studentNumber: string;
  date: string;
  time: string;
  status: string;
  paymentMethod: string;
  collectionChannel: string | null;
  officialReceiptNumber: string | null;
  pickupSchedule: string | null;
  reservationReference: string | null;
  transactionReference: string;
  verificationUrl: string | null;
  verifiedBy: string;
  items: Array<{
    name: string;
    detail: string;
    quantity: number;
    unitPrice: number;
  }>;
  subtotal: number;
  discount: number;
  total: number;
};

function formatCurrency(value: number) {
  return `PHP ${value.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function formatReceiptStatus(value: BackendReceiptStatus) {
  if (value === "VERIFIED") return "Verified";
  if (value === "VOIDED") return "Voided";
  return "Pending";
}

function receiptStatusDisplay(status: string) {
  if (status === "Verified") return { color: "#00652f", label: "VERIFIED DIGITAL RECEIPT", iconClass: "size-5 text-primary" };
  if (status === "Voided") return { color: "#b42318", label: "VOIDED DIGITAL RECEIPT", iconClass: "size-5 text-red-700" };
  return { color: "#a46a00", label: "PENDING VERIFICATION", iconClass: "size-5 text-[#b37700]" };
}

function formatReceiptDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: value, time: "" };

  return {
    date: date.toLocaleDateString("en-PH", {
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "Asia/Manila"
    }),
    time: date.toLocaleTimeString("en-PH", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "Asia/Manila"
    })
  };
}

function mapBackendReceipt(receipt: BackendReceipt): Receipt {
  const issued = formatReceiptDateTime(receipt.issuedAt || receipt.createdAt);
  const reservationItems = receipt.reservation?.items.length
    ? receipt.reservation.items.map((item) => ({
        name: item.product?.name ?? "Campus Item",
        detail: item.variantSummary || item.product?.description || "Reserved item",
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice)
      }))
    : null;
  const walkInItems = receipt.walkInSaleItems?.length
    ? receipt.walkInSaleItems.map((item) => ({
        name: item.productName,
        detail: item.options.length
          ? item.options.map((option) => `${option.optionName}: ${option.optionValue}`).join(", ")
          : "Walk-in purchase",
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice)
      }))
    : null;
  const items = reservationItems ?? walkInItems ?? [
    {
      name: receipt.reservation?.referenceCode ?? "Commissary Purchase",
      detail: "Completed transaction",
      quantity: 1,
      unitPrice: Number(receipt.totalAmount)
    }
  ];
  const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);

  return {
    id: receipt.id,
    code: receipt.receiptCode,
    student: receipt.student?.fullName || receipt.student?.email || "Student",
    studentNumber: receipt.student?.studentNumber ?? "",
    date: issued.date,
    time: issued.time,
    status: formatReceiptStatus(receipt.status),
    paymentMethod: paymentMethodLabel(receipt.paymentMethod),
    collectionChannel: receipt.collectionChannel ? collectionChannelLabel(receipt.collectionChannel) : null,
    officialReceiptNumber: receipt.officialReceiptNumber ?? null,
    pickupSchedule: receipt.reservation?.pickupStart
      ? formatReceiptDateTime(receipt.reservation.pickupStart).date + (receipt.reservation.pickupEnd
        ? `, ${formatReceiptDateTime(receipt.reservation.pickupStart).time}–${formatReceiptDateTime(receipt.reservation.pickupEnd).time}`
        : "")
      : null,
    reservationReference: receipt.reservation?.referenceCode ?? null,
    transactionReference: receipt.receiptCode,
    verificationUrl: receipt.publicVerificationUrl,
    verifiedBy: receipt.status === "VERIFIED" ? receipt.issuedBy?.fullName ?? "" : "",
    items,
    subtotal,
    discount: 0,
    total: Number(receipt.totalAmount)
  };
}

function ReceiptQrCode({ value, label }: { value: string | null; label: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!value || !canvasRef.current) return;
    void QRCode.toCanvas(canvasRef.current, value, {
      width: 168,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#17211b", light: "#ffffff" }
    });
  }, [value]);

  return value ? (
    <canvas ref={canvasRef} role="img" aria-label={label} className="mx-auto mt-4 size-[168px] rounded-md bg-white" />
  ) : (
    <p className="mx-auto mt-4 max-w-xs rounded-md bg-[#f3f6f3] px-3 py-4 text-xs font-semibold text-[#68746d]">Secure QR verification is being prepared.</p>
  );
}


function ReceiptPaper({
  receipt,
  compact = false,
  headingId
}: {
  receipt: Receipt;
  compact?: boolean;
  headingId?: string;
}) {
  return (
    <div className={compact ? "relative bg-white px-5 py-6" : "relative bg-white px-6 py-8 sm:px-9"}>
      <div className="absolute inset-x-0 top-0 h-2 bg-[radial-gradient(circle_at_8px_-2px,transparent_8px,#fff_9px)] bg-[length:16px_10px]" />
      <div className="text-center">
        <Image
          src="/assets/wescomm-logo.webp"
          alt="WESCOMM"
          width={1589}
          height={990}
          className={compact ? "mx-auto h-auto w-[125px] object-contain" : "mx-auto h-auto w-[165px] object-contain"}
        />
        {!compact ? (
          <>
            <p className="mt-2 text-sm font-extrabold text-[#17211b]">Wesleyan University-Philippines</p>
            <p className="text-xs text-[#68746d]">Integrated Commissary Management System</p>
          </>
        ) : null}
        <div className="my-4 border-t border-dashed border-[#bfc9c1]" />
        <p className="text-xs font-bold uppercase text-[#68746d]">Digital Receipt</p>
        <h2 id={headingId} className="mt-1 text-xl font-extrabold text-primary">
          <span className="sr-only">Digital receipt </span>
          {receipt.code}
        </h2>
      </div>

      <dl className="mt-5 grid grid-cols-[1fr_auto] gap-x-5 gap-y-2 text-sm">
        <dt className="text-[#68746d]">Date</dt>
        <dd className="text-right font-semibold">{receipt.date}</dd>
        <dt className="text-[#68746d]">Time</dt>
        <dd className="text-right font-semibold">{receipt.time}</dd>
        <dt className="text-[#68746d]">Student</dt>
        <dd className="text-right font-semibold">{receipt.student}</dd>
        <dt className="text-[#68746d]">Payment method</dt>
        <dd className="text-right font-semibold">{receipt.paymentMethod}</dd>
        {receipt.collectionChannel ? (
          <>
            <dt className="text-[#68746d]">Collected by</dt>
            <dd className="text-right font-semibold">{receipt.collectionChannel}</dd>
          </>
        ) : null}
        {receipt.officialReceiptNumber ? (
          <>
            <dt className="text-[#68746d]">Treasury OR No.</dt>
            <dd className="break-all text-right font-mono text-xs font-bold">{receipt.officialReceiptNumber}</dd>
          </>
        ) : null}
        {receipt.pickupSchedule ? (
          <>
            <dt className="text-[#68746d]">Pickup</dt>
            <dd className="text-right font-semibold">{receipt.pickupSchedule}</dd>
          </>
        ) : null}
        {receipt.reservationReference ? (
          <>
            <dt className="text-[#68746d]">Reservation</dt>
            <dd className="break-all text-right font-mono text-xs font-bold">{receipt.reservationReference}</dd>
          </>
        ) : null}
      </dl>

      <div className="my-4 border-t border-dashed border-[#bfc9c1]" />
      <div className="space-y-3">
        {receipt.items.slice(0, compact ? 2 : receipt.items.length).map((item) => (
          <div key={`${item.name}-${item.detail}`} className="grid grid-cols-[1fr_auto] gap-3 text-sm">
            <div>
              <p className="font-bold text-[#26322b]">{item.quantity} x {item.name}</p>
              <p className="text-xs text-[#77817b]">{item.detail}</p>
            </div>
            <p className="font-bold">{formatCurrency(item.unitPrice * item.quantity)}</p>
          </div>
        ))}
        {compact && receipt.items.length > 2 ? (
          <p className="text-xs font-semibold text-primary">+ {receipt.items.length - 2} more item</p>
        ) : null}
      </div>

      <div className="my-4 border-t border-dashed border-[#bfc9c1]" />
      <div className="flex items-end justify-between">
        <span className="font-extrabold text-[#26322b]">TOTAL</span>
        <span className="text-2xl font-extrabold text-primary">{formatCurrency(receipt.total)}</span>
      </div>
      <div className="mt-4 flex items-center justify-center gap-2 rounded-md bg-[#f2f7f2] px-3 py-2">
        <ShieldCheck className={receiptStatusDisplay(receipt.status).iconClass} />
        <StatusBadge status={receipt.status} />
      </div>
      <div className="absolute inset-x-0 bottom-0 h-2 rotate-180 bg-[radial-gradient(circle_at_8px_-2px,transparent_8px,#fff_9px)] bg-[length:16px_10px]" />
    </div>
  );
}

function ReceiptModal({
  receipt,
  onClose,
  returnFocusRef
}: {
  receipt: Receipt | null;
  onClose: () => void;
  returnFocusRef: MutableRefObject<HTMLButtonElement | null>;
}) {
  const [mounted, setMounted] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const receiptIdentity = receipt?.id ?? null;

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!receiptIdentity) return;
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
      } else if (
        !event.shiftKey &&
        (document.activeElement === lastElement || !dialog.contains(document.activeElement))
      ) {
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
  }, [receiptIdentity, onClose, returnFocusRef]);

  if (!mounted || !receipt) return null;

  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[9000] grid place-items-center overflow-y-auto bg-[#101820]/55 p-3 backdrop-blur-[2px] sm:p-6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="selected-receipt-title"
        className="relative my-auto w-full max-w-[590px] overflow-hidden rounded-lg bg-[#edf2ed] p-3 shadow-[0_30px_90px_rgba(0,0,0,0.28)] sm:p-6"
      >
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          aria-label={`Close receipt ${receipt.code}`}
          className="absolute right-5 top-5 z-10 grid size-10 place-items-center rounded-md border border-[#d6dfd7] bg-white shadow-sm hover:bg-[#eef6ee]"
        >
          <X className="size-5" />
        </button>
        <div className="max-h-[calc(100svh-155px)] overflow-y-auto shadow-[0_10px_35px_rgba(0,0,0,0.12)]">
          <ReceiptPaper receipt={receipt} headingId="selected-receipt-title" />
          <div className="bg-white px-6 pb-8 sm:px-9">
            <div className="border-t border-dashed border-[#bfc9c1] pt-5 text-center">
              <p className="text-xs font-bold uppercase text-[#68746d]">Verification Reference</p>
              <p className="mt-1 break-all text-sm font-extrabold text-primary">{receipt.transactionReference}</p>
              <ReceiptQrCode value={receipt.verificationUrl} label={`Secure verification QR for receipt ${receipt.code}`} />
              <p className="mt-4 text-xs leading-5 text-[#77817b]">Keep this digital receipt for verification and record purposes.</p>
            </div>
          </div>
        </div>
        <Button className="mt-4 h-12 w-full text-base" onClick={() => downloadReceiptPng(receipt)}>
          <Download className="size-5" />
          Download Receipt as PNG
        </Button>
      </section>
    </div>,
    document.body
  );
}

const RECEIPT_FILTERS: Array<{ label: string; status: BackendReceiptStatus | null }> = [
  { label: "All", status: null },
  { label: "Verified", status: "VERIFIED" },
  { label: "Pending", status: "PENDING" },
  { label: "Voided", status: "VOIDED" }
];

function formatSummaryPeso(value: number) {
  return `PHP ${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function StudentReceiptsExperience() {
  const { user, ready: authReady, openAuth } = useStudentAuth();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [selectedReceiptId, setSelectedReceiptId] = useState<string | null>(null);
  const receiptTriggerRef = useRef<HTMLButtonElement | null>(null);
  const requestSequenceRef = useRef(0);
  const openedDeepLinkRef = useRef<string | null>(null);
  const accountId = user?.id ?? "";
  const cacheKey = receiptCacheKey(accountId);
  const receiptPage = useServerState<CursorPage<BackendReceipt>>(cacheKey);
  const { overview } = useStudentOverview();
  const [statusFilter, setStatusFilter] = useState<BackendReceiptStatus | null>(null);
  const [searchText, setSearchText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [filteredPage, setFilteredPage] = useState<{ key: string; items: BackendReceipt[]; nextCursor: string | null; loading: boolean; error: string } | null>(null);
  const filterAbortRef = useRef<AbortController | null>(null);
  const filtersActive = Boolean(statusFilter || searchQuery);
  const filterKey = `${statusFilter ?? ""}|${searchQuery}`;

  useEffect(() => {
    const timer = window.setTimeout(() => setSearchQuery(searchText.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchText]);

  // Filtered views are queried on the server so older receipts are never missed.
  const loadFilteredReceipts = useCallback(async (cursor?: string) => {
    if (!user?.accessToken || !filtersActive) return;
    filterAbortRef.current?.abort();
    const controller = new AbortController();
    filterAbortRef.current = controller;
    setFilteredPage((current) => current?.key === filterKey ? { ...current, loading: true, error: "" } : { key: filterKey, items: [], nextCursor: null, loading: true, error: "" });
    try {
      const page = await getReceiptPageFromApi(user.accessToken, { limit: 20, cursor, status: statusFilter ?? undefined, query: searchQuery || undefined, signal: controller.signal });
      setFilteredPage((current) => ({
        key: filterKey,
        items: cursor && current?.key === filterKey ? [...current.items, ...page.items] : page.items,
        nextCursor: page.nextCursor,
        loading: false,
        error: ""
      }));
    } catch (filterError) {
      if (isRequestAbortError(filterError) || controller.signal.aborted) return;
      setFilteredPage((current) => ({ key: filterKey, items: current?.key === filterKey ? current.items : [], nextCursor: null, loading: false, error: userFacingErrorMessage(filterError, "Unable to search your receipts.") }));
    }
  }, [filterKey, filtersActive, searchQuery, statusFilter, user?.accessToken]);

  useEffect(() => {
    if (filtersActive) void loadFilteredReceipts();
    else {
      filterAbortRef.current?.abort();
      setFilteredPage(null);
    }
  }, [filtersActive, loadFilteredReceipts]);

  const allReceipts = useMemo(() => (receiptPage?.items ?? []).map(mapBackendReceipt), [receiptPage]);
  const filteredReceipts = useMemo(
    () => filteredPage?.key === filterKey ? filteredPage.items.map(mapBackendReceipt) : [],
    [filterKey, filteredPage]
  );
  const visibleReceipts = filtersActive ? filteredReceipts : allReceipts;
  const filterLoading = filtersActive && (filteredPage?.key !== filterKey || (filteredPage.loading && !filteredPage.items.length));
  const listNextCursor = filtersActive ? filteredPage?.nextCursor ?? null : receiptPage?.nextCursor ?? null;
  const selectedReceipt = selectedReceiptId
    ? allReceipts.find((receipt) => receipt.id === selectedReceiptId) ?? filteredReceipts.find((receipt) => receipt.id === selectedReceiptId) ?? null
    : null;
  const clearFilters = () => {
    setStatusFilter(null);
    setSearchText("");
    setSearchQuery("");
  };
  const closeReceipt = useCallback(() => setSelectedReceiptId(null), []);

  const loadReceipts = useCallback(async ({
    background = false,
    cursor
  }: { background?: boolean; cursor?: string } = {}) => {
    if (!authReady) return;
    const requestSequence = ++requestSequenceRef.current;

    if (!user?.accessToken || !accountId) {
      setSelectedReceiptId(null);
      setLoading(false);
      return;
    }

    if (cursor) setLoadingMore(true);
    else if (!background) {
      setLoading(true);
      setError("");
    }

    try {
      const page = await getReceiptPageFromApi(user.accessToken, { limit: 20, cursor });
      if (requestSequence !== requestSequenceRef.current) return;
      writeServerState<CursorPage<BackendReceipt>>(cacheKey, (current) =>
        mergeCursorPage(current, page, cursor ? "append" : background ? "prepend" : "replace")
      );
    } catch (receiptError) {
      if (requestSequence === requestSequenceRef.current && !background) {
        setSelectedReceiptId(null);
        setError(userFacingErrorMessage(receiptError, "Unable to load receipts."));
      }
    } finally {
      if (requestSequence === requestSequenceRef.current && cursor) setLoadingMore(false);
      if (requestSequence === requestSequenceRef.current && !background) setLoading(false);
    }
  }, [accountId, authReady, cacheKey, user?.accessToken]);

  useRealtimeRefresh(["receipts"], () => {
    void loadReceipts({ background: true });
    if (filtersActive) void loadFilteredReceipts();
  });

  useEffect(() => {
    setSelectedReceiptId(null);
    const cached = readServerState<CursorPage<BackendReceipt>>(cacheKey);
    if (cached) {
      setLoading(false);
      if (Date.now() - cached.updatedAt >= 60_000) void loadReceipts({ background: true });
    } else {
      void loadReceipts();
    }
    return () => {
      requestSequenceRef.current += 1;
    };
  }, [accountId, cacheKey, loadReceipts]);

  useEffect(() => {
    if (!authReady || !user?.accessToken || !accountId) return;
    const parameters = new URLSearchParams(window.location.search);
    const receiptId = parameters.get("receiptId")?.trim();
    if (!receiptId || openedDeepLinkRef.current === receiptId) return;
    openedDeepLinkRef.current = receiptId;
    parameters.delete("receiptId");
    const nextQuery = parameters.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}`);

    void getReceiptFromApi(user.accessToken, receiptId)
      .then((receipt) => {
        upsertCursorItem(cacheKey, receipt, true);
        setSelectedReceiptId(receipt.id);
      })
      .catch((receiptError) => {
        setError(userFacingErrorMessage(receiptError, "Unable to open this receipt."));
      });
  }, [accountId, authReady, cacheKey, user?.accessToken]);

  useEffect(() => {
    if (!authReady || !user?.accessToken) return;

    const refreshInBackground = () => {
      if (document.visibilityState === "visible") void loadReceipts({ background: true });
    };

    const interval = window.setInterval(refreshInBackground, 5 * 60_000);
    window.addEventListener("focus", refreshInBackground);
    document.addEventListener("visibilitychange", refreshInBackground);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshInBackground);
      document.removeEventListener("visibilitychange", refreshInBackground);
    };
  }, [accountId, authReady, loadReceipts, user?.accessToken]);

  return (
    <>
      <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-primary">Digital Receipts</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">My receipt history</h1>
          <p className="mt-2 text-sm text-muted-foreground">View verified transaction details and download official receipt copies.</p>
        </div>
        <Link href="/verify-receipt" className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-border-strong bg-card px-4 text-sm font-bold text-primary transition hover:bg-primary/5">
          <AssetIcon src="/assets/verified.svg" className="size-5" />
          Verify a receipt code
        </Link>
      </header>

      {user?.accessToken && overview ? (
        <section aria-label="Receipt summary" className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border bg-card p-4 shadow-soft">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Spent this month</p>
            <p className="mt-1 text-xl font-extrabold tabular-nums text-primary">{formatSummaryPeso(overview.spentThisMonth)}</p>
          </div>
          <div className="rounded-xl border bg-card p-4 shadow-soft">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Verified receipts</p>
            <p className="mt-1 text-xl font-extrabold tabular-nums text-foreground">{overview.receipts.VERIFIED}</p>
          </div>
          <div className="rounded-xl border bg-card p-4 shadow-soft">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Awaiting verification</p>
            <p className={cn("mt-1 text-xl font-extrabold tabular-nums", overview.receipts.PENDING ? "text-warning" : "text-foreground")}>{overview.receipts.PENDING}</p>
          </div>
        </section>
      ) : null}

      {!authReady || loading ? (
        <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3" role="status" aria-label="Loading your digital receipts...">
          {Array.from({ length: 3 }, (_, index) => <div key={index} className="h-[30rem] animate-pulse rounded-xl border bg-card motion-reduce:animate-none" />)}
        </div>
      ) : !user?.accessToken ? (
        <section className="rounded-lg border border-[#dce5dd] bg-white p-6 shadow-sm">
          <p className="font-extrabold text-[#17211b]">Log in to view your receipts</p>
          <p className="mt-2 max-w-xl text-sm leading-6 text-[#68746d]">
            Use your Wesleyan account to access official receipt copies, verification references, and downloads.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              href="/verify-receipt"
              className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-[0_8px_18px_rgba(0,91,43,0.22)] transition-colors hover:bg-[#004320] focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              Search Receipt Code
            </Link>
            <Button className="h-11" variant="secondary" onClick={openAuth}>Log in with Wesleyan account</Button>
          </div>
        </section>
      ) : (
        <>
          {error ? <InlineAlert onDismiss={() => setError("")}>{error}</InlineAlert> : null}

          {allReceipts.length || filtersActive ? (
            <section aria-label="Find receipts" className="flex flex-col gap-3 rounded-xl border bg-card p-3 shadow-soft md:flex-row md:items-center">
              <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-control border border-border-strong bg-card px-3 transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15">
                <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <input
                  type="search"
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  placeholder="Search receipt code or reservation reference"
                  aria-label="Search receipts"
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none focus-visible:outline-none placeholder:text-muted-foreground"
                />
                {searchText ? (
                  <button type="button" onClick={() => setSearchText("")} aria-label="Clear receipt search" className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
                    <X className="size-4" />
                  </button>
                ) : null}
              </label>
              <div role="group" aria-label="Filter receipts by status" className="flex gap-1 overflow-x-auto rounded-lg bg-surface-subtle p-1">
                {RECEIPT_FILTERS.map((filter) => {
                  const selected = statusFilter === filter.status;
                  const count = overview ? (filter.status ? overview.receipts[filter.status] : overview.receipts.total) : null;
                  return (
                    <button
                      key={filter.label}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setStatusFilter(filter.status)}
                      className={cn(
                        "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm font-bold transition-colors",
                        selected ? "bg-card text-primary shadow-soft" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {filter.label}
                      {count !== null ? <span aria-hidden="true" className="text-xs tabular-nums text-muted-foreground">{count}</span> : null}
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null}
          {filtersActive && filteredPage?.error ? <InlineAlert>{filteredPage.error}</InlineAlert> : null}

          {filterLoading ? (
            <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3" role="status" aria-label="Searching receipts">
              {Array.from({ length: 3 }, (_, index) => <div key={index} className="h-[30rem] animate-pulse rounded-xl border bg-card motion-reduce:animate-none" />)}
            </div>
          ) : visibleReceipts.length ? (
            <>
            <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
              {visibleReceipts.map((receipt) => (
                <article key={receipt.id} className="content-visibility-auto overflow-hidden rounded-xl border bg-surface-subtle p-3 shadow-soft">
                  <div className="overflow-hidden shadow-[0_8px_24px_rgba(0,0,0,0.09)]">
                    <ReceiptPaper receipt={receipt} compact />
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Button
                      variant="secondary"
                      className="h-11"
                      aria-label={`View receipt ${receipt.code}`}
                      onClick={(event) => {
                        receiptTriggerRef.current = event.currentTarget;
                        // Avoid leaving focus inside content that becomes aria-hidden
                        // before the dialog takes focus on the next animation frame.
                        event.currentTarget.blur();
                        setSelectedReceiptId(receipt.id);
                        if (user?.accessToken) {
                          void getReceiptFromApi(user.accessToken, receipt.id)
                            .then((detail) => upsertCursorItem(cacheKey, detail))
                            .catch(() => undefined);
                        }
                      }}
                    >
                      <Eye className="size-4" />
                      View receipt
                    </Button>
                    <Button
                      className="h-11"
                      aria-label={`Download receipt ${receipt.code} as PNG`}
                      onClick={() => downloadReceiptPng(receipt)}
                    >
                      <Download className="size-4" />
                      PNG
                    </Button>
                  </div>
                </article>
              ))}
            </div>
            {listNextCursor ? (
              <div className="mt-5 flex justify-center">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={filtersActive ? filteredPage?.loading : loadingMore}
                  onClick={() => filtersActive ? void loadFilteredReceipts(listNextCursor) : void loadReceipts({ cursor: listNextCursor })}
                >
                  {(filtersActive ? filteredPage?.loading : loadingMore) ? "Loading more..." : "Load more receipts"}
                </Button>
              </div>
            ) : null}
            </>
          ) : (
            <section className="flex flex-col items-center rounded-xl border border-dashed border-border-strong bg-card p-8 text-center">
              <span className="grid size-12 place-items-center rounded-full bg-primary/10"><AssetIcon src="/assets/digital-receipts.svg" className="size-7" /></span>
              <p className="mt-3 font-extrabold text-foreground">{filtersActive ? "No receipts match your search" : "No receipts yet"}</p>
              <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                {filtersActive
                  ? "Try another receipt code or reservation reference, or clear the filters."
                  : "Completed reservations will appear here after staff generates or verifies the digital receipt."}
              </p>
              {filtersActive ? <Button type="button" variant="secondary" className="mt-4" onClick={clearFilters}>Clear filters</Button> : (
                <Link href="/student/shop" className="mt-4 inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground hover:bg-primary-hover">Browse items</Link>
              )}
            </section>
          )}
        </>
      )}

      </div>
      <ReceiptModal receipt={selectedReceipt} onClose={closeReceipt} returnFocusRef={receiptTriggerRef} />
    </>
  );
}
