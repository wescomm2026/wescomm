"use client";

import { userFacingErrorMessage } from "@/lib/user-facing-error";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronLeft, ChevronRight, Minus, Plus, X } from "lucide-react";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import {
  PaymentMethodSelector,
  type StudentCheckoutPaymentMethod
} from "@/components/checkout/PaymentMethodSelector";
import { useStudentRestriction } from "@/components/restrictions/StudentRestrictionProvider";
import { PolicyConsentCheckbox } from "@/components/legal/PolicyConsentCheckbox";
import { ActionLoadingOverlay } from "@/components/ui/ActionLoadingOverlay";
import { AssetIcon } from "@/components/ui/AssetIcon";
import { Button } from "@/components/ui/button";
import {
  PickupSchedulePicker,
  type PickupSelection,
  type PickupSelectionSummary
} from "@/components/pickup/PickupSchedulePicker";
import { useAccessibleDialog } from "@/components/ui/useAccessibleDialog";
import {
  BackendApiError,
  createGcashCheckoutFromApi,
  createReservationFromApi,
  requestProductsRefresh,
  type BackendReservation
} from "@/lib/api";
import { reservationCacheKey, upsertCursorItem } from "@/lib/server-state";
import {
  getPaymentIdempotencyKey,
  openTrustedPaymongoCheckout,
  rememberPaymentCheckout
} from "@/lib/payment-checkout";
import {
  hasCompleteProductSelections,
  isProductUnavailable,
  isUniformClothOnly,
  productOptionValueStock,
  productPurchaseLimit,
  selectedProductAvailability,
  selectedProductSkuId,
  productStockCount,
  UNIFORM_CLOTH_NOTICE
} from "@/lib/product-display";
import {
  clearReservationRequestIdentity,
  getReservationRequestIdentity,
  type PendingReservationRequest
} from "@/lib/reservation-idempotency";
import { cn } from "@/lib/utils";
import { currentCheckoutPolicyAcceptance } from "@/lib/policy-consent";

export type CheckoutProduct = {
  id?: string;
  name: string;
  category: string;
  detail: string;
  price: string;
  oldPrice: string;
  status: string;
  count: string;
  image: string;
  options: Array<{
    name: string;
    values: string[];
    stockByValue?: Record<string, number>;
  }>;
};

const PICKUP_RECOVERY_CODES = new Set([
  "PICKUP_POLICY_CHANGED",
  "PICKUP_DATE_CLOSED",
  "PICKUP_SLOT_UNAVAILABLE",
  "PICKUP_SLOT_FULL"
]);

function parsePrice(price: string) {
  return Number(price.replace(/[^0-9.]/g, ""));
}

function formatPrice(value: number) {
  return `PHP ${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatSelections(options: Record<string, string>) {
  return Object.entries(options).map(([name, value]) => `${name}: ${value}`).join(", ");
}

function CheckoutSteps({ step }: { step: 1 | 2 }) {
  return (
    <ol className="mt-4 flex max-w-md items-center text-xs font-bold sm:text-sm" aria-label="Reservation checkout progress">
      <li className="flex items-center gap-2 text-primary" aria-current={step === 1 ? "step" : undefined}>
        <span className={cn("grid size-7 place-items-center rounded-full", step === 1 ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary")}>{step === 2 ? <Check className="size-4" /> : "1"}</span>
        <span>Item &amp; Pickup</span>
      </li>
      <li className={cn("mx-3 h-px flex-1", step === 2 ? "bg-primary" : "bg-border-strong")} aria-hidden="true" />
      <li className={cn("flex items-center gap-2", step === 2 ? "text-primary" : "text-muted-foreground")} aria-current={step === 2 ? "step" : undefined}>
        <span className={cn("grid size-7 place-items-center rounded-full", step === 2 ? "bg-primary text-primary-foreground" : "bg-muted")}>2</span>
        <span>Payment</span>
      </li>
    </ol>
  );
}

export function StudentCheckoutModal({
  product,
  onClose
}: {
  product: CheckoutProduct | null;
  relatedProducts?: CheckoutProduct[];
  onSwitchProduct?: (product: CheckoutProduct) => void;
  onClose: () => void;
}) {
  const { user, openAuth } = useStudentAuth();
  const { summary: restrictionSummary, isReservationRestricted } = useStudentRestriction();
  const [mounted, setMounted] = useState(false);
  const [checkoutStep, setCheckoutStep] = useState<1 | 2>(1);
  const [quantity, setQuantity] = useState(1);
  const [pickupSelection, setPickupSelection] = useState<PickupSelection | null>(null);
  const [pickupSummary, setPickupSummary] = useState<PickupSelectionSummary | null>(null);
  const [pickupRefreshKey, setPickupRefreshKey] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<StudentCheckoutPaymentMethod | null>(null);
  const [policyAccepted, setPolicyAccepted] = useState(false);
  const [notes, setNotes] = useState("");
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [reference, setReference] = useState("");
  const [gcashRecovery, setGcashRecovery] = useState<{
    reservationId: string;
    referenceCode: string;
    message: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const stepHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const pendingRequestRef = useRef<PendingReservationRequest | null>(null);

  useEffect(() => setMounted(true), []);
  useEffect(() => { submittingRef.current = submitting; }, [submitting]);

  const checkoutDialog = useAccessibleDialog<HTMLElement>(Boolean(product && mounted), () => {
    if (!submittingRef.current) onClose();
  });

  useEffect(() => {
    if (!product) return;
    setCheckoutStep(1);
    setQuantity(1);
    setPickupSelection(null);
    setPickupSummary(null);
    setPickupRefreshKey(0);
    setPaymentMethod(null);
    setPolicyAccepted(false);
    setNotes("");
    setSelectedOptions({});
    setError("");
    setReference("");
    setGcashRecovery(null);
    setSubmitting(false);
    pendingRequestRef.current = null;
  }, [product]);

  useEffect(() => {
    if (!mounted || reference || gcashRecovery) return;
    const frame = window.requestAnimationFrame(() => stepHeadingRef.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [checkoutStep, gcashRecovery, mounted, reference]);

  const unitPrice = product ? parsePrice(product.price) : 0;
  const stockCount = product ? productStockCount(product) : 0;
  const clothOnly = product ? isUniformClothOnly(product) : false;
  const selectionsComplete = product ? clothOnly || hasCompleteProductSelections(product, selectedOptions) : false;
  const stockUnavailable = product ? isProductUnavailable(product) : true;
  const maxQuantity = product ? productPurchaseLimit(product, 10, selectedOptions) : 0;
  const selectedAvailability = product ? selectedProductAvailability(product, selectedOptions) : 0;
  const unavailable = stockUnavailable || !selectionsComplete || maxQuantity === 0;
  const total = useMemo(() => unitPrice * quantity, [quantity, unitPrice]);
  const missingOption = clothOnly ? undefined : product?.options.find((option) => !selectedOptions[option.name]);

  useEffect(() => {
    if (maxQuantity > 0) setQuantity((current) => Math.min(current, maxQuantity));
  }, [maxQuantity]);

  const stepOneBlockingMessage = isReservationRestricted
    ? "Your reservation access is currently paused."
    : stockUnavailable
      ? "This item is currently out of stock."
      : missingOption
        ? `Please select ${missingOption.name}.`
        : maxQuantity === 0
          ? "The selected item option is unavailable."
          : !pickupSelection
            ? "Please choose a pickup date and time."
            : "";

  const openGcashCheckout = async (reservation: Pick<BackendReservation, "id" | "referenceCode">) => {
    if (!user?.accessToken) throw new Error("Please sign in again to continue.");
    const checkout = await createGcashCheckoutFromApi(user.accessToken, reservation.id, getPaymentIdempotencyKey(reservation.id));
    if (!rememberPaymentCheckout(checkout.payment, checkout.checkoutUrl)) {
      throw new Error("WESCOMM blocked an invalid payment destination. Please try again.");
    }
    openTrustedPaymongoCheckout(checkout.checkoutUrl);
  };

  const continueGcashPayment = async () => {
    if (!gcashRecovery) return;
    setSubmitting(true);
    setError("");
    try {
      await openGcashCheckout({ id: gcashRecovery.reservationId, referenceCode: gcashRecovery.referenceCode });
    } catch (paymentError) {
      setError(userFacingErrorMessage(paymentError, "Unable to open GCash payment."));
    } finally {
      setSubmitting(false);
    }
  };

  const continueToPayment = () => {
    setError("");
    if (!user) {
      openAuth();
      return;
    }
    if (stepOneBlockingMessage) {
      setError(stepOneBlockingMessage);
      return;
    }
    setCheckoutStep(2);
  };

  const confirmReservation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    if (checkoutStep !== 2) {
      continueToPayment();
      return;
    }
    if (!user) {
      openAuth();
      return;
    }
    if (isReservationRestricted) {
      setError("Your reservation access is currently paused. You can still browse items and contact Support for assistance.");
      return;
    }
    if (!product || unavailable || !pickupSelection) {
      setCheckoutStep(1);
      setError(stepOneBlockingMessage || "Review your item and pickup details before continuing.");
      return;
    }
    if (!paymentMethod) {
      setError("Please choose how you would like to pay.");
      return;
    }
    if (!policyAccepted) {
      setError("Review and accept the reservation and refund terms before confirming.");
      return;
    }
    if (!product.id) {
      setError("Refresh the shop so this item's current availability can be checked.");
      return;
    }
    if (!user.accessToken) {
      setError("Please sign in again to continue.");
      openAuth();
      return;
    }

    const itemDetails = formatSelections(selectedOptions);
    const noteDetails = notes.trim();
    const variantSummary = [itemDetails, noteDetails ? `Note: ${noteDetails}` : ""].filter(Boolean).join(" | ");
    const skuId = selectedProductSkuId(product, selectedOptions);
    const payload = {
      paymentMethod,
      ...pickupSelection,
      policyAcceptance: currentCheckoutPolicyAcceptance(),
      items: [{ productId: product.id, ...(skuId ? { skuId } : {}), variantSummary, quantity }]
    };
    const requestIdentity = getReservationRequestIdentity(payload, pendingRequestRef.current, user.id);
    pendingRequestRef.current = requestIdentity;

    setSubmitting(true);
    try {
      const reservation = await createReservationFromApi(user.accessToken, payload, requestIdentity.key);
      upsertCursorItem(reservationCacheKey(user.id), reservation, true);
      clearReservationRequestIdentity(user.id, requestIdentity);
      pendingRequestRef.current = null;
      requestProductsRefresh();
      if (paymentMethod === "PAYMONGO_GCASH") {
        setGcashRecovery({ reservationId: reservation.id, referenceCode: reservation.referenceCode, message: "Your reservation is saved. Continue to the secure GCash payment page." });
        try {
          await openGcashCheckout(reservation);
        } catch (paymentError) {
          setGcashRecovery({ reservationId: reservation.id, referenceCode: reservation.referenceCode, message: userFacingErrorMessage(paymentError, "Unable to open GCash payment.") });
        }
      } else {
        setReference(reservation.referenceCode);
      }
    } catch (reservationError) {
      if (reservationError instanceof BackendApiError && reservationError.code === "RESERVATION_ACCESS_SUSPENDED") {
        window.dispatchEvent(new Event("wescomm:restriction-refresh"));
      }
      if (reservationError instanceof BackendApiError && reservationError.code && PICKUP_RECOVERY_CODES.has(reservationError.code)) {
        setCheckoutStep(1);
        setPickupSelection(null);
        setPickupSummary(null);
        setPickupRefreshKey((current) => current + 1);
        setError("Pickup availability changed. Please choose another date and time.");
      } else {
        setError(userFacingErrorMessage(reservationError, "Unable to submit reservation."));
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!mounted || !product) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9000] grid place-items-center overflow-y-auto bg-foreground/55 p-0 backdrop-blur-sm sm:p-6" role="presentation" onMouseDown={(event) => { if (!submitting && event.target === event.currentTarget) onClose(); }}>
      <section ref={checkoutDialog.dialogRef} {...checkoutDialog.dialogProps} className="relative flex h-[100svh] w-full flex-col overflow-hidden border bg-white shadow-overlay outline-none sm:h-auto sm:max-h-[calc(100svh-48px)] sm:max-w-5xl sm:rounded-feature">
        <Button type="button" variant="secondary" size="icon" onClick={onClose} disabled={submitting} aria-label="Close checkout" className="absolute right-4 top-4 z-20"><X className="size-5" /></Button>

        {gcashRecovery ? (
          <div className="flex min-h-[560px] flex-col items-center justify-center overflow-y-auto px-6 py-16 text-center">
            <span className="grid size-20 place-items-center rounded-full bg-warning/10 text-warning"><AssetIcon src="/assets/e-wallet.svg" className="size-14" /></span>
            <p className="mt-6 text-sm font-bold uppercase text-primary">Reservation saved</p>
            <h1 id={checkoutDialog.titleId} className="mt-2 text-3xl font-extrabold text-foreground sm:text-4xl">Complete your GCash payment</h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">{gcashRecovery.message}</p>
            <div className="mt-7 rounded-surface border border-primary/20 bg-primary/5 px-7 py-5"><p className="text-xs font-bold uppercase text-muted-foreground">Reservation reference</p><p className="mt-1 text-2xl font-extrabold text-primary">{gcashRecovery.referenceCode}</p></div>
            {error ? <p className="mt-4 max-w-xl rounded-control border border-danger/25 bg-danger/5 px-4 py-3 text-sm font-semibold text-danger" role="alert">{error}</p> : null}
            <div className="mt-8 flex w-full max-w-md flex-col gap-3 sm:flex-row"><Link href="/student/reservations" className="flex-1" onClick={onClose}><Button variant="secondary" size="lg" className="w-full">View Reservation</Button></Link><Button size="lg" className="flex-1" onClick={() => void continueGcashPayment()} loading={submitting}><AssetIcon src="/assets/e-wallet.svg" className="size-6" />Continue Payment</Button></div>
          </div>
        ) : reference ? (
          <div className="flex min-h-[560px] flex-col items-center justify-center overflow-y-auto px-6 py-16 text-center">
            <span className="grid size-20 place-items-center rounded-full bg-primary/10 text-primary"><AssetIcon src="/assets/confirmed.svg" className="size-14" /></span>
            <p className="mt-6 text-sm font-bold uppercase text-primary">Reservation submitted</p>
            <h1 id={checkoutDialog.titleId} className="mt-2 text-3xl font-extrabold text-foreground sm:text-4xl">Your item is awaiting confirmation</h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">Commissary staff will review the stock and pickup schedule. Payment will be collected using your selected method.</p>
            <div className="mt-7 rounded-surface border border-primary/20 bg-primary/5 px-7 py-5"><p className="text-xs font-bold uppercase text-muted-foreground">Reservation reference</p><p className="mt-1 text-2xl font-extrabold text-primary">{reference}</p></div>
            <div className="mt-8 flex w-full max-w-md flex-col gap-3 sm:flex-row"><Button variant="secondary" size="lg" className="flex-1" onClick={onClose}><ChevronLeft className="size-4" />Continue Shopping</Button><Link href="/student/reservations" className="flex-1" onClick={onClose}><Button size="lg" className="w-full"><AssetIcon src="/assets/my-reservations.svg" className="size-6" />My Reservations</Button></Link></div>
          </div>
        ) : (
          <form className="relative flex min-h-0 flex-1 flex-col" onSubmit={confirmReservation}>
            <ActionLoadingOverlay active={submitting} title="Submitting your reservation" detail="We are checking stock and saving your pickup schedule." />
            <header className="shrink-0 border-b px-5 pb-4 pt-5 sm:px-8">
              <p className="text-xs font-extrabold uppercase tracking-wide text-primary">Reserve item</p>
              <h1 ref={stepHeadingRef} id={checkoutDialog.titleId} tabIndex={-1} className="mt-1 pr-12 text-2xl font-extrabold text-foreground outline-none sm:text-3xl" data-dialog-autofocus>
                {checkoutStep === 1 ? "Item and pickup details" : "Choose payment method"}
              </h1>
              <CheckoutSteps step={checkoutStep} />
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {checkoutStep === 1 ? (
                <div className="space-y-6 p-5 sm:p-8">
                  <section className="grid gap-4 rounded-surface border bg-surface-subtle p-4 sm:grid-cols-[112px_1fr]">
                    <div className="relative h-28 overflow-hidden rounded-control bg-white"><Image src={product.image} alt={product.name} fill sizes="112px" className="object-contain p-3" /></div>
                    <div className="min-w-0"><span className="inline-flex rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">{product.status}</span><h2 className="mt-2 text-xl font-extrabold text-foreground">{product.name}</h2><p className="mt-1 text-sm text-muted-foreground">{product.detail}</p><div className="mt-2 flex flex-wrap items-center gap-2"><p className="text-xl font-extrabold text-primary">{product.price}</p>{product.oldPrice ? <p className="text-sm text-muted-foreground line-through">{product.oldPrice}</p> : null}<span className="text-xs text-muted-foreground">· {stockCount} available</span></div></div>
                  </section>

                  {clothOnly ? <section className="rounded-surface border border-primary/20 bg-primary/5 p-4"><div className="flex items-start gap-3"><AssetIcon src="/assets/uniforms.svg" className="size-9 shrink-0" /><div><p className="font-extrabold text-primary">Uniform cloth only</p><p className="mt-1 text-sm leading-6 text-muted-foreground">{UNIFORM_CLOTH_NOTICE}</p></div></div></section> : null}

                  {!clothOnly && product.options.length ? <section className="space-y-5">{product.options.map((option) => <fieldset key={option.name}><legend className="font-extrabold text-foreground">{option.name}</legend><div className="mt-2 flex flex-wrap gap-2">{option.values.map((value) => { const valueStock = productOptionValueStock(product, option.name, value, selectedOptions); const valueUnavailable = valueStock === 0; return <button key={value} type="button" disabled={submitting || valueUnavailable} onClick={() => { setSelectedOptions((current) => current[option.name] === value ? Object.fromEntries(Object.entries(current).filter(([name]) => name !== option.name)) : { ...current, [option.name]: value }); setError(""); }} className={cn("min-h-11 rounded-control border px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground", selectedOptions[option.name] === value ? "border-primary bg-primary/10 text-primary ring-1 ring-primary" : "border-border-strong bg-white hover:border-primary")}>{value}{valueUnavailable ? " — Out of stock" : valueStock !== null ? ` (${valueStock} available)` : ""}</button>; })}</div></fieldset>)}</section> : null}

                  <section><h2 className="flex items-center gap-2 font-extrabold text-foreground"><AssetIcon src="/assets/orders.svg" className="size-7" />Quantity</h2><div className="mt-3 flex flex-wrap items-center gap-3"><Button type="button" variant="secondary" size="icon" onClick={() => setQuantity((current) => Math.max(1, current - 1))} disabled={submitting || unavailable || quantity === 1} aria-label="Decrease quantity"><Minus className="size-4" /></Button><span className="grid h-10 min-w-14 place-items-center rounded-control border bg-white px-4 font-extrabold">{quantity}</span><Button type="button" variant="secondary" size="icon" onClick={() => setQuantity((current) => Math.min(maxQuantity, current + 1))} disabled={submitting || unavailable || quantity >= maxQuantity} aria-label="Increase quantity"><Plus className="size-4" /></Button><span className="text-xs text-muted-foreground">{stockUnavailable ? "This item is currently unavailable" : !selectionsComplete ? "Choose the required item option first" : `${selectedAvailability} available · ${Math.max(0, selectedAvailability - quantity)} remaining after reservation`}</span></div></section>

                  <section><h2 className="flex items-center gap-2 font-extrabold text-foreground"><AssetIcon src="/assets/pick-up.svg" className="size-7" />Pickup details</h2><div className="mt-3"><PickupSchedulePicker selection={pickupSelection} onChange={setPickupSelection} onSelectionSummary={setPickupSummary} disabled={submitting} autoSelectFirst={false} refreshKey={pickupRefreshKey} /></div></section>

                  <label className="grid gap-1.5 text-sm font-semibold text-foreground">Notes for commissary staff <span className="font-normal text-muted-foreground">(optional)</span><textarea value={notes} maxLength={180} onChange={(event) => setNotes(event.target.value)} disabled={submitting} placeholder="Size, color, or other pickup details" className="min-h-20 rounded-control border border-border-strong bg-white px-3 py-2 text-sm font-normal outline-none focus:border-primary focus:ring-2 focus:ring-primary/10" /></label>

                  {error ? <p className="rounded-control border border-danger/25 bg-danger/5 px-3 py-2.5 text-sm font-medium text-danger" role="alert">{error}</p> : stepOneBlockingMessage ? <p className="rounded-control border bg-surface-subtle px-3 py-2.5 text-sm font-medium text-muted-foreground" role="status">{stepOneBlockingMessage}</p> : null}
                  {restrictionSummary?.activeRestriction ? <p className="rounded-control border border-danger/25 bg-danger/5 px-3 py-2.5 text-sm leading-6 text-danger" role="alert"><strong>Reservation access is paused.</strong> {restrictionSummary.activeRestriction.reason}</p> : null}
                </div>
              ) : (
                <div className="grid gap-6 p-5 sm:p-8 lg:grid-cols-[1fr_0.9fr]">
                  <section><h2 className="text-lg font-extrabold text-foreground">Reservation summary</h2><div className="mt-4 rounded-surface border bg-surface-subtle p-4"><div className="flex gap-3"><div className="relative size-20 shrink-0 overflow-hidden rounded-control bg-white"><Image src={product.image} alt="" fill sizes="80px" className="object-contain p-2" /></div><div className="min-w-0"><p className="font-extrabold text-foreground">{product.name}</p>{Object.keys(selectedOptions).length ? <p className="mt-1 text-sm text-muted-foreground">{formatSelections(selectedOptions)}</p> : null}<p className="mt-1 text-sm text-muted-foreground">Quantity: {quantity}</p></div></div><dl className="mt-4 grid gap-3 border-t pt-4 text-sm"><div className="flex justify-between gap-4"><dt className="text-muted-foreground">Pickup</dt><dd className="max-w-[65%] text-right font-bold text-foreground">{pickupSummary ? `${pickupSummary.dateLabel} · ${pickupSummary.slotLabel}` : pickupSelection?.pickupDate}</dd></div><div className="flex items-end justify-between gap-4 border-t pt-3"><dt className="font-bold text-foreground">Total</dt><dd className="text-2xl font-extrabold text-primary">{formatPrice(total)}</dd></div></dl></div>{notes.trim() ? <p className="mt-3 rounded-control border px-3 py-2 text-sm text-muted-foreground"><strong className="text-foreground">Note:</strong> {notes.trim()}</p> : null}</section>
                  <section className="space-y-4"><PaymentMethodSelector name="payment" value={paymentMethod} onChange={setPaymentMethod} disabled={submitting} legend="How would you like to pay?" /><PolicyConsentCheckbox id="buy-now-policy-consent" checked={policyAccepted} onCheckedChange={(checked) => { setPolicyAccepted(checked); if (checked) setError(""); }} disabled={submitting} context="checkout" />{error ? <p className="rounded-control border border-danger/25 bg-danger/5 px-3 py-2.5 text-sm font-medium text-danger" role="alert">{error}</p> : null}{!user ? <p className="rounded-control border border-warning/25 bg-warning/5 px-3 py-2.5 text-sm text-warning">Log in with your Wesleyan account before confirming.</p> : <p className="text-xs leading-5 text-muted-foreground">Reserving as <strong>{user.email}</strong></p>}</section>
                </div>
              )}
            </div>

            <footer className="shrink-0 border-t bg-white p-4 sm:px-8">
              {checkoutStep === 1 ? <div className="flex flex-col gap-3 sm:flex-row sm:items-center"><div className="sm:mr-auto"><p className="text-xs font-semibold uppercase text-muted-foreground">Total</p><p className="text-xl font-extrabold text-primary">{formatPrice(total)}</p></div><Button type="button" variant="secondary" size="lg" onClick={onClose} disabled={submitting}>Cancel</Button><Button type="button" size="lg" onClick={continueToPayment} disabled={Boolean(user && stepOneBlockingMessage)}>{user ? <>Next: Payment <ChevronRight className="size-4" /></> : "Sign in to continue"}</Button></div> : <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><Button type="button" variant="secondary" size="lg" onClick={() => { setCheckoutStep(1); setError(""); }} disabled={submitting}><ChevronLeft className="size-4" />Back</Button><Button type="submit" size="lg" disabled={!paymentMethod || !policyAccepted || isReservationRestricted} loading={submitting}><AssetIcon src={paymentMethod === "PAYMONGO_GCASH" ? "/assets/e-wallet.svg" : "/assets/verified.svg"} className="size-6" />{paymentMethod === "PAYMONGO_GCASH" ? "Continue to GCash" : "Confirm Reservation"}</Button></div>}
            </footer>
          </form>
        )}
      </section>
    </div>,
    document.body
  );
}
