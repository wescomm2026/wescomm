"use client";

import { userFacingErrorMessage } from "@/lib/user-facing-error";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Clock3, RefreshCw, ShieldCheck, WalletCards } from "lucide-react";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  createGcashCheckoutFromApi,
  getPaymentFromApi,
  type BackendPaymentStatus,
  type BackendPaymentSummary
} from "@/lib/api";
import {
  getPaymentIdempotencyKey,
  getRememberedPaymentCheckout,
  openTrustedPaymongoCheckout,
  rememberPaymentCheckout
} from "@/lib/payment-checkout";

const POLL_DELAYS_MS = [0, 2_000, 3_000, 5_000, 7_000, 10_000, 10_000, 8_000] as const;
const pollingStatuses = new Set<BackendPaymentStatus>([
  "INITIALIZING",
  "AWAITING_PAYMENT",
  "REFUND_REVIEW_REQUIRED"
]);

function formatAmount(payment: BackendPaymentSummary) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: payment.currency || "PHP"
  }).format(payment.amountMinor / 100);
}

function paymentDisplay(status: BackendPaymentStatus) {
  if (status === "PAID") {
    return {
      badge: "Paid",
      title: "Payment confirmed",
      detail: "WESCOMM received secure confirmation from PayMongo. Your reservation now shows the official online payment status."
    };
  }
  if (status === "AWAITING_PAYMENT") {
    return {
      badge: "Awaiting payment",
      title: "Complete your GCash payment",
      detail: "Your reservation is saved, but payment has not yet been confirmed. Continue only through the secure GCash payment page."
    };
  }
  if (status === "INITIALIZING") {
    return {
      badge: "Initializing",
      title: "Preparing payment confirmation",
      detail: "WESCOMM is preparing the secure payment record. This usually takes only a moment."
    };
  }
  if (status === "REFUND_REVIEW_REQUIRED") {
    return {
      badge: "Refund review required",
      title: "This payment needs staff review",
      detail: "A payment was received after the checkout was closed. No refund has started yet; WESCOMM staff must review and approve the next action."
    };
  }
  if (status === "PARTIALLY_REFUNDED") {
    return {
      badge: "Partially refunded",
      title: "Part of this payment was refunded",
      detail: "The payment record reflects the confirmed partial refund. Contact Support if you need more details."
    };
  }
  if (status === "REFUNDED") {
    return {
      badge: "Refunded",
      title: "Payment refunded",
      detail: "WESCOMM received confirmation that this GCash payment was refunded."
    };
  }
  if (status === "EXPIRED") {
    return {
      badge: "Expired",
      title: "The payment session expired",
      detail: "No payment was confirmed. You can start a new secure GCash session if WESCOMM allows it."
    };
  }
  if (status === "CANCELLED") {
    return {
      badge: "Cancelled",
      title: "The payment was cancelled",
      detail: "No payment was confirmed. Your reservation remains the source of truth for the next available action."
    };
  }
  return {
    badge: "Failed",
    title: "The payment was not completed",
    detail: "No successful payment was recorded. Try again only through WESCOMM if the option is available."
  };
}

function wait(delayMs: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, delayMs));
}

export function StudentPaymentReturnExperience({ paymentId }: { paymentId: string }) {
  const { user, ready: authReady, openAuthAt } = useStudentAuth();
  const [payment, setPayment] = useState<BackendPaymentSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [pollingComplete, setPollingComplete] = useState(false);
  const [error, setError] = useState("");
  const requestSequenceRef = useRef(0);
  const errorRef = useRef<HTMLParagraphElement | null>(null);
  const accessToken = user?.accessToken ?? "";

  const refreshPayment = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
    if (!accessToken) return null;
    const requestSequence = ++requestSequenceRef.current;
    if (!background) setRefreshing(true);

    try {
      const nextPayment = await getPaymentFromApi(accessToken, paymentId);
      if (requestSequence !== requestSequenceRef.current) return nextPayment;
      setPayment(nextPayment);
      setError("");
      return nextPayment;
    } catch (paymentError) {
      if (requestSequence === requestSequenceRef.current) {
        setError(userFacingErrorMessage(paymentError, "Unable to check this payment."));
      }
      return null;
    } finally {
      if (requestSequence === requestSequenceRef.current) {
        setLoading(false);
        if (!background) setRefreshing(false);
      }
    }
  }, [accessToken, paymentId]);

  useEffect(() => {
    if (!authReady) return;
    if (!accessToken) {
      setLoading(false);
      setPayment(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setPollingComplete(false);

    const poll = async () => {
      for (const delayMs of POLL_DELAYS_MS) {
        if (delayMs) await wait(delayMs);
        if (cancelled) return;
        const nextPayment = await refreshPayment({ background: true });
        if (!nextPayment || !pollingStatuses.has(nextPayment.status)) return;
      }
      if (!cancelled) setPollingComplete(true);
    };

    void poll();
    return () => {
      cancelled = true;
      requestSequenceRef.current += 1;
    };
  }, [accessToken, authReady, refreshPayment]);

  useEffect(() => {
    if (!error) return;
    errorRef.current?.focus();
  }, [error]);

  useEffect(() => {
    if (!accessToken) return;
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshPayment({ background: true });
    };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [accessToken, refreshPayment]);

  const continuePayment = async () => {
    if (!payment || !accessToken) return;
    setContinuing(true);
    setError("");

    try {
      const rememberedUrl = payment.canResume
        ? getRememberedPaymentCheckout(payment.id, payment.reservationId)
        : null;
      if (rememberedUrl) {
        openTrustedPaymongoCheckout(rememberedUrl);
        return;
      }

      const checkout = await createGcashCheckoutFromApi(
        accessToken,
        payment.reservationId,
        getPaymentIdempotencyKey(payment.reservationId, { renew: payment.canRetry })
      );
      if (!rememberPaymentCheckout(checkout.payment, checkout.checkoutUrl)) {
        throw new Error("WESCOMM blocked an invalid payment destination. Please try again.");
      }
      openTrustedPaymongoCheckout(checkout.checkoutUrl);
    } catch (paymentError) {
      setError(userFacingErrorMessage(paymentError, "Unable to continue this payment."));
    } finally {
      setContinuing(false);
    }
  };

  const display = payment ? paymentDisplay(payment.status) : null;
  const showContinue = Boolean(payment && (payment.canResume || payment.canRetry) && payment.status !== "PAID");

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6" aria-labelledby="payment-return-title">
      <header>
        <p className="text-sm font-bold uppercase text-primary">Secure online payment</p>
        <h1 id="payment-return-title" className="mt-1 text-3xl font-extrabold text-[#101820] sm:text-4xl">
          GCash payment status
        </h1>
        <p className="mt-2 text-sm leading-6 text-[#657169]">
          WESCOMM confirms the payment with the payment service. Returning to this page or showing a screenshot does not mark a payment as paid.
        </p>
      </header>

      {!authReady || loading ? (
        <section className="rounded-lg border border-[#dce5dd] bg-white p-6 shadow-sm" role="status" aria-live="polite">
          <div className="flex items-center gap-3 text-sm font-semibold text-[#58645d]">
            <RefreshCw className="size-5 animate-spin text-primary" aria-hidden="true" />
            Checking the official payment record...
          </div>
        </section>
      ) : !accessToken ? (
        <section className="rounded-lg border border-[#dce5dd] bg-white p-6 shadow-sm">
          <ShieldCheck className="size-10 text-primary" aria-hidden="true" />
          <h2 className="mt-4 text-xl font-extrabold text-[#17211b]">Log in to check this payment</h2>
          <p className="mt-2 text-sm leading-6 text-[#657169]">Only the student who owns the reservation can view its payment status.</p>
          <Button className="mt-5 h-11" onClick={() => openAuthAt(`/student/payments/${encodeURIComponent(paymentId)}`)}>
            Log in with Wesleyan account
          </Button>
        </section>
      ) : error && !payment ? (
        <section className="rounded-lg border border-red-200 bg-red-50 p-6 shadow-sm">
          <p ref={errorRef} tabIndex={-1} role="alert" className="font-semibold text-red-700">{error}</p>
          <Button variant="secondary" className="mt-5 h-11" onClick={() => void refreshPayment()} disabled={refreshing}>
            <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} />
            Try Again
          </Button>
        </section>
      ) : payment && display ? (
        <section className="overflow-hidden rounded-xl border border-[#cfdfd1] bg-white shadow-[0_18px_50px_rgba(0,91,43,0.08)]">
          <div className="border-b border-[#e1e9e2] bg-[#f4f9f4] p-5 sm:p-7" role="status" aria-live="polite" aria-atomic="true">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-4">
                <span className="grid size-14 shrink-0 place-items-center rounded-full bg-white text-primary shadow-sm">
                  {payment.status === "PAID" ? <CheckCircle2 className="size-8" aria-hidden="true" /> : <Clock3 className="size-8" aria-hidden="true" />}
                </span>
                <div>
                  <StatusBadge status={display.badge} />
                  <h2 className="mt-3 text-2xl font-extrabold text-[#17211b]">{display.title}</h2>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-[#657169]">{display.detail}</p>
                </div>
              </div>
              {!payment.livemode ? (
                <span className="w-fit rounded-full bg-[#fff1b8] px-3 py-1 text-xs font-extrabold uppercase tracking-wide text-[#725300]">
                  Test mode - no real charge
                </span>
              ) : null}
            </div>
          </div>

          <dl className="grid gap-4 p-5 text-sm sm:grid-cols-2 sm:p-7">
            <div className="rounded-lg border border-[#e0e8e1] p-4">
              <dt className="text-xs font-bold uppercase text-[#707b74]">Amount</dt>
              <dd className="mt-1 text-xl font-extrabold text-primary">{formatAmount(payment)}</dd>
            </div>
            <div className="rounded-lg border border-[#e0e8e1] p-4">
              <dt className="text-xs font-bold uppercase text-[#707b74]">Method</dt>
              <dd className="mt-1 flex items-center gap-2 font-extrabold text-[#17211b]"><WalletCards className="size-5 text-primary" />GCash via PayMongo</dd>
            </div>
            {payment.providerReference ? (
              <div className="rounded-lg border border-[#e0e8e1] p-4 sm:col-span-2">
                <dt className="text-xs font-bold uppercase text-[#707b74]">Payment reference</dt>
                <dd className="mt-1 break-all font-extrabold text-[#17211b]">{payment.providerReference}</dd>
              </div>
            ) : null}
          </dl>

          {error ? (
            <p ref={errorRef} tabIndex={-1} role="alert" className="mx-5 mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 sm:mx-7">
              {error}
            </p>
          ) : null}
          {pollingComplete && pollingStatuses.has(payment.status) ? (
            <p className="mx-5 mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 sm:mx-7">
              Confirmation is taking longer than usual. Do not pay again; use Refresh Status in a moment.
            </p>
          ) : null}

          <div className="flex flex-col gap-3 border-t border-[#e1e9e2] p-5 sm:flex-row sm:p-7">
            <Link href="/student/reservations" className="sm:flex-1">
              <Button variant="secondary" className="h-12 w-full">View My Reservations</Button>
            </Link>
            <Button className="h-12 sm:flex-1" onClick={() => void refreshPayment()} disabled={refreshing || continuing} aria-busy={refreshing}>
              <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} />
              {refreshing ? "Checking..." : "Refresh Status"}
            </Button>
            {showContinue ? (
              <Button className="h-12 sm:flex-1" onClick={() => void continuePayment()} disabled={continuing || refreshing} aria-busy={continuing}>
                <WalletCards className="size-5" />
                {continuing ? "Opening GCash..." : payment.canRetry ? "Try GCash Again" : "Continue to GCash"}
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}
    </main>
  );
}
