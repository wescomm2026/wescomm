"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronLeft, ChevronRight, Minus, Plus, ShoppingBag, X } from "lucide-react";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import { useStudentCart } from "@/components/cart/StudentCartProvider";
import {
  PaymentMethodSelector,
  type StudentCheckoutPaymentMethod
} from "@/components/checkout/PaymentMethodSelector";
import { useStudentRestriction } from "@/components/restrictions/StudentRestrictionProvider";
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
  isProductUnavailable,
  isUniformClothOnly,
  productPurchaseLimit,
  selectedProductAvailability,
  selectedProductSkuId,
  UNIFORM_CLOTH_NOTICE
} from "@/lib/product-display";
import {
  clearReservationRequestIdentity,
  getReservationRequestIdentity,
  type PendingReservationRequest
} from "@/lib/reservation-idempotency";

const PICKUP_RECOVERY_CODES = new Set([
  "PICKUP_POLICY_CHANGED",
  "PICKUP_DATE_CLOSED",
  "PICKUP_SLOT_UNAVAILABLE"
]);

function parsePrice(price: string) {
  return Number(price.replace(/[^0-9.]/g, ""));
}

function formatPrice(value: number) {
  return `PHP ${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatSelectedOptions(options: Record<string, string>) {
  return Object.entries(options)
    .map(([name, value]) => `${name}: ${value}`)
    .join(", ");
}

function CartCheckoutSteps({ step }: { step: 1 | 2 }) {
  return (
    <ol className="mt-3 flex items-center text-xs font-bold" aria-label="Cart checkout progress">
      <li className="flex items-center gap-1.5 text-primary" aria-current={step === 1 ? "step" : undefined}>
        <span className={`grid size-6 place-items-center rounded-full ${step === 1 ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary"}`}>{step === 2 ? <Check className="size-3.5" /> : "1"}</span>
        <span>Items &amp; Pickup</span>
      </li>
      <li className={`mx-2 h-px flex-1 ${step === 2 ? "bg-primary" : "bg-border-strong"}`} aria-hidden="true" />
      <li className={`flex items-center gap-1.5 ${step === 2 ? "text-primary" : "text-muted-foreground"}`} aria-current={step === 2 ? "step" : undefined}>
        <span className={`grid size-6 place-items-center rounded-full ${step === 2 ? "bg-primary text-primary-foreground" : "bg-muted"}`}>2</span>
        <span>Payment</span>
      </li>
    </ol>
  );
}

export function StudentCartDrawer() {
  const { items, itemCount, open, closeCart, updateQuantity, removeItem, clearCart } = useStudentCart();
  const { user, openAuth } = useStudentAuth();
  const { summary: restrictionSummary, isReservationRestricted } = useStudentRestriction();
  const [mounted, setMounted] = useState(false);
  const [checkout, setCheckout] = useState(false);
  const [checkoutStep, setCheckoutStep] = useState<1 | 2>(1);
  const [pickupSelection, setPickupSelection] = useState<PickupSelection | null>(null);
  const [pickupSummary, setPickupSummary] = useState<PickupSelectionSummary | null>(null);
  const [pickupRefreshKey, setPickupRefreshKey] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<StudentCheckoutPaymentMethod | null>(null);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [reference, setReference] = useState("");
  const [gcashRecovery, setGcashRecovery] = useState<{
    reservationId: string;
    referenceCode: string;
    message: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const pendingRequestRef = useRef<PendingReservationRequest | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => { submittingRef.current = submitting; }, [submitting]);

  const cartDialog = useAccessibleDialog<HTMLElement>(mounted && open, () => {
    if (!submittingRef.current) closeCart();
  });

  useEffect(() => {
    if (!open) {
      setCheckout(false);
      setCheckoutStep(1);
      setPickupSelection(null);
      setPickupSummary(null);
      setPickupRefreshKey(0);
      setPaymentMethod(null);
      setNotes("");
      setError("");
      setReference("");
      setGcashRecovery(null);
      setSubmitting(false);
      pendingRequestRef.current = null;
    }
  }, [open]);

  const total = useMemo(
    () => items.reduce((sum, item) => sum + parsePrice(item.product.price) * item.quantity, 0),
    [items]
  );
  const unavailableItems = useMemo(
    () => items.filter((item) => (
      isProductUnavailable(item.product)
      || productPurchaseLimit(item.product, 10, item.selectedOptions) === 0
    )),
    [items]
  );
  const hasUnavailableItems = unavailableItems.length > 0;

  const openGcashCheckout = async (reservation: Pick<BackendReservation, "id" | "referenceCode">) => {
    if (!user?.accessToken) throw new Error("Please sign in again to continue.");

    const result = await createGcashCheckoutFromApi(
      user.accessToken,
      reservation.id,
      getPaymentIdempotencyKey(reservation.id)
    );
    if (!rememberPaymentCheckout(result.payment, result.checkoutUrl)) {
      throw new Error("WESCOMM blocked an invalid payment destination. Please try again.");
    }
    openTrustedPaymongoCheckout(result.checkoutUrl);
  };

  const continueGcashPayment = async () => {
    if (!gcashRecovery) return;
    setSubmitting(true);
    setError("");
    try {
      await openGcashCheckout({ id: gcashRecovery.reservationId, referenceCode: gcashRecovery.referenceCode });
    } catch (paymentError) {
      setError(paymentError instanceof Error ? paymentError.message : "Unable to open GCash payment.");
    } finally {
      setSubmitting(false);
    }
  };

  const startCheckout = () => {
    if (hasUnavailableItems) {
      setError("Remove unavailable items before checking out.");
      return;
    }
    if (!user) {
      openAuth();
      return;
    }
    if (isReservationRestricted) {
      setError("Your reservation access is currently paused. Contact Support if you need assistance.");
      return;
    }
    setPickupSelection(null);
    setPickupSummary(null);
    setPaymentMethod(null);
    setCheckoutStep(1);
    setCheckout(true);
    setError("");
  };

  const continueToPayment = () => {
    setError("");
    if (!pickupSelection) {
      setError("Please choose a pickup date and time.");
      return;
    }
    if (hasUnavailableItems) {
      setError("One or more cart items are unavailable. Return to the cart and remove them before continuing.");
      return;
    }
    if (isReservationRestricted) {
      setError("Your reservation access is currently paused. Contact Support if you need assistance.");
      return;
    }
    setCheckoutStep(2);
  };

  const confirmCart = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (checkoutStep !== 2) {
      continueToPayment();
      return;
    }
    if (!user) {
      openAuth();
      return;
    }
    if (isReservationRestricted) {
      setError("Your reservation access is currently paused. Contact Support if you need assistance.");
      return;
    }
    if (!user.accessToken) {
      setError("Please sign in again to continue.");
      openAuth();
      return;
    }
    if (!pickupSelection) {
      setCheckoutStep(1);
      setError("Please choose a pickup date and time.");
      return;
    }
    if (!paymentMethod) {
      setError("Please choose how you would like to pay.");
      return;
    }
    if (items.some((item) => !item.product.id)) {
      setError("Refresh the shop so all cart items can be reserved from the live inventory.");
      return;
    }
    if (hasUnavailableItems) {
      setError("One or more cart items are unavailable. Return to the cart and remove them before checking out.");
      return;
    }

    const payload = {
      paymentMethod,
      ...pickupSelection,
      items: items.map((item) => {
        const effectiveOptions = item.product.saleMode === "OPTIONS"
          ? item.selectedOptions
          : item.product.saleMode || isUniformClothOnly(item.product)
            ? {}
            : item.selectedOptions;
        const selectedOptions = formatSelectedOptions(effectiveOptions);
        const noteDetails = notes.trim();
        const variantSummary = [selectedOptions, noteDetails ? `Note: ${noteDetails}` : ""].filter(Boolean).join(" | ");
        const skuId = selectedProductSkuId(item.product, effectiveOptions);

        return {
          productId: item.product.id!,
          ...(skuId ? { skuId } : {}),
          variantSummary,
          quantity: item.quantity
        };
      })
    };
    const requestIdentity = getReservationRequestIdentity(payload, pendingRequestRef.current, user.id);
    pendingRequestRef.current = requestIdentity;

    setSubmitting(true);
    try {
      const reservation = await createReservationFromApi(user.accessToken, payload, requestIdentity.key);

      upsertCursorItem(reservationCacheKey(user.id), reservation, true);
      clearReservationRequestIdentity(user.id, requestIdentity);
      clearCart();
      pendingRequestRef.current = null;
      requestProductsRefresh();
      if (paymentMethod === "PAYMONGO_GCASH") {
        setGcashRecovery({
          reservationId: reservation.id,
          referenceCode: reservation.referenceCode,
          message: "Your reservation is saved. Continue to the secure GCash payment page."
        });
        try {
          await openGcashCheckout(reservation);
        } catch (paymentError) {
          setGcashRecovery({
            reservationId: reservation.id,
            referenceCode: reservation.referenceCode,
            message: paymentError instanceof Error ? paymentError.message : "Unable to open GCash payment."
          });
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
        setError(reservationError instanceof Error ? reservationError.message : "Unable to submit cart reservation.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!mounted || !open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[8500] bg-[#101820]/50 backdrop-blur-[2px]" role="presentation" onMouseDown={(event) => {
      if (!submitting && event.target === event.currentTarget) closeCart();
    }}>
      <aside
        ref={cartDialog.dialogRef}
        {...cartDialog.dialogProps}
        className="relative ml-auto flex h-[100svh] w-full max-w-[520px] flex-col bg-white shadow-[-24px_0_70px_rgba(0,0,0,0.22)]"
      >
        <header className="flex h-20 shrink-0 items-center border-b border-[#e4ebe5] px-5 sm:px-6">
          <AssetIcon src="/assets/cart.svg" className="size-9" />
          <div className="ml-3">
            <h2 id={cartDialog.titleId} className="text-xl font-extrabold text-[#17211b]">
              {checkout ? checkoutStep === 1 ? "Review Items & Pickup" : "Payment & Review" : "My Cart"}
            </h2>
            <p className="text-xs text-[#69746e]">{itemCount} item{itemCount === 1 ? "" : "s"}</p>
          </div>
          <button
            type="button"
            onClick={closeCart}
            disabled={submitting}
            aria-label="Close cart"
            className="ml-auto grid size-10 place-items-center rounded-md text-[#344139] hover:bg-[#eef6ee]"
          >
            <X className="size-5" />
          </button>
        </header>

        {gcashRecovery ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-10 text-center">
            <AssetIcon src="/assets/e-wallet.svg" className="size-20" />
            <p className="mt-5 text-sm font-bold uppercase text-primary">Reservation saved</p>
            <h3 className="mt-2 text-2xl font-extrabold text-[#17211b]">Complete your GCash payment</h3>
            <p className="mt-3 text-sm leading-6 text-[#657169]">{gcashRecovery.message}</p>
            <div className="mt-6 rounded-md border border-[#cfe0d0] bg-[#f4faf4] px-5 py-4">
              <p className="text-xs font-bold uppercase text-[#6b766f]">Group reference</p>
              <p className="mt-1 text-xl font-extrabold text-primary">{gcashRecovery.referenceCode}</p>
            </div>
            {error ? (
              <p tabIndex={-1} className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700" role="alert">{error}</p>
            ) : null}
            <div className="mt-7 grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
              <Link href="/student/reservations" onClick={closeCart}>
                <Button variant="secondary" className="h-12 w-full">View Reservation</Button>
              </Link>
              <Button className="h-12 w-full" onClick={() => void continueGcashPayment()} disabled={submitting} aria-busy={submitting}>
                <AssetIcon src="/assets/e-wallet.svg" className="size-6" />
                {submitting ? "Opening GCash..." : "Continue Payment"}
              </Button>
            </div>
          </div>
        ) : reference ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-10 text-center">
            <AssetIcon src="/assets/confirmed.svg" className="size-20" />
            <p className="mt-5 text-sm font-bold uppercase text-primary">Cart reservation submitted</p>
            <h3 className="mt-2 text-2xl font-extrabold text-[#17211b]">All items are awaiting confirmation</h3>
            <p className="mt-3 text-sm leading-6 text-[#657169]">
              Your items share the same pickup schedule and will be reviewed by commissary staff.
            </p>
            <div className="mt-6 rounded-md border border-[#cfe0d0] bg-[#f4faf4] px-5 py-4">
              <p className="text-xs font-bold uppercase text-[#6b766f]">Group reference</p>
              <p className="mt-1 text-xl font-extrabold text-primary">{reference}</p>
            </div>
            <Link href="/student/reservations" className="mt-7 w-full" onClick={closeCart}>
              <Button className="h-12 w-full">
                <AssetIcon src="/assets/my-reservations.svg" className="size-6" />
                View My Reservations
              </Button>
            </Link>
          </div>
        ) : checkout ? (
          <form className="relative flex min-h-0 flex-1 flex-col" onSubmit={confirmCart}>
            <ActionLoadingOverlay active={submitting} title="Submitting cart reservation" detail="We are checking each item and saving one pickup schedule." />
            <div className="shrink-0 border-b px-5 pb-4 sm:px-6"><CartCheckoutSteps step={checkoutStep} /></div>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5 sm:p-6">
              {checkoutStep === 1 ? (
                <>
                  <section className="rounded-surface border bg-surface-subtle p-4">
                    <div className="flex items-end justify-between gap-4"><div><p className="text-sm font-bold text-foreground">{items.length} product{items.length === 1 ? "" : "s"} in this reservation</p><p className="mt-1 text-xs text-muted-foreground">All items share one pickup schedule.</p></div><p className="text-2xl font-extrabold text-primary">{formatPrice(total)}</p></div>
                    <div className="mt-4 grid gap-2 border-t pt-3">
                      {items.map((item) => <div key={item.id} className="flex justify-between gap-3 text-sm"><span className="min-w-0 truncate font-semibold text-foreground">{item.product.name} <span className="text-muted-foreground">×{item.quantity}</span></span><span className="shrink-0 font-bold text-foreground">{formatPrice(parsePrice(item.product.price) * item.quantity)}</span></div>)}
                    </div>
                  </section>

                  {hasUnavailableItems ? <p className="rounded-control border border-warning/25 bg-warning/5 px-3 py-2 text-sm font-semibold text-warning" role="alert">One or more cart items are no longer available. Go back and remove them before continuing.</p> : null}

                  {items.some((item) => isUniformClothOnly(item.product)) ? <section className="rounded-surface border border-primary/20 bg-primary/5 p-4"><div className="flex items-start gap-3"><AssetIcon src="/assets/uniforms.svg" className="size-8 shrink-0" /><div><p className="font-extrabold text-primary">Uniform cloth only</p><p className="mt-1 text-sm leading-6 text-muted-foreground">{UNIFORM_CLOTH_NOTICE}</p></div></div></section> : null}

                  <section><h3 className="flex items-center gap-2 font-extrabold text-foreground"><AssetIcon src="/assets/pick-up.svg" className="size-7" />Pickup details</h3><div className="mt-3"><PickupSchedulePicker selection={pickupSelection} onChange={setPickupSelection} onSelectionSummary={setPickupSummary} disabled={submitting} autoSelectFirst={false} refreshKey={pickupRefreshKey} /></div></section>

                  <label className="grid gap-1.5 text-sm font-semibold text-foreground">Notes <span className="font-normal text-muted-foreground">(optional)</span><textarea value={notes} maxLength={180} onChange={(event) => setNotes(event.target.value)} disabled={submitting} className="min-h-20 rounded-control border border-border-strong px-3 py-2 font-normal outline-none focus:border-primary" placeholder="Pickup details for commissary staff" /></label>
                </>
              ) : (
                <>
                  <section className="rounded-surface border bg-surface-subtle p-4">
                    <p className="font-extrabold text-foreground">Reservation summary</p>
                    <dl className="mt-3 grid gap-3 text-sm">
                      <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Items</dt><dd className="font-bold text-foreground">{itemCount}</dd></div>
                      <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Pickup</dt><dd className="max-w-[65%] text-right font-bold text-foreground">{pickupSummary ? `${pickupSummary.dateLabel} · ${pickupSummary.slotLabel}` : pickupSelection?.pickupDate}</dd></div>
                      <div className="flex items-end justify-between gap-4 border-t pt-3"><dt className="font-bold text-foreground">Total</dt><dd className="text-2xl font-extrabold text-primary">{formatPrice(total)}</dd></div>
                    </dl>
                    {notes.trim() ? <p className="mt-3 border-t pt-3 text-sm text-muted-foreground"><strong className="text-foreground">Note:</strong> {notes.trim()}</p> : null}
                  </section>
                  <PaymentMethodSelector name="cart-payment" value={paymentMethod} onChange={setPaymentMethod} disabled={submitting} legend="How would you like to pay?" />
                </>
              )}

              {error ? <p className="rounded-control border border-danger/25 bg-danger/5 px-3 py-2 text-sm font-medium text-danger" role="alert">{error}</p> : checkoutStep === 1 && !pickupSelection ? <p className="rounded-control border bg-surface-subtle px-3 py-2 text-sm text-muted-foreground" role="status">Please choose a pickup date and time.</p> : null}
              {restrictionSummary?.activeRestriction ? <p className="rounded-control border border-danger/25 bg-danger/5 px-3 py-2 text-sm leading-6 text-danger"><strong>Reservation access is paused.</strong> {restrictionSummary.activeRestriction.reason}</p> : null}
            </div>
            <footer className="grid shrink-0 grid-cols-2 gap-3 border-t p-5 sm:p-6">
              {checkoutStep === 1 ? (
                <><Button type="button" variant="secondary" size="lg" onClick={() => setCheckout(false)} disabled={submitting}>Back to Cart</Button><Button type="button" size="lg" onClick={continueToPayment} disabled={!pickupSelection || isReservationRestricted || hasUnavailableItems}>Next: Payment <ChevronRight className="size-4" /></Button></>
              ) : (
                <><Button type="button" variant="secondary" size="lg" onClick={() => { setCheckoutStep(1); setError(""); }} disabled={submitting}><ChevronLeft className="size-4" />Back</Button><Button type="submit" size="lg" disabled={!paymentMethod || isReservationRestricted || hasUnavailableItems} loading={submitting}><AssetIcon src={paymentMethod === "PAYMONGO_GCASH" ? "/assets/e-wallet.svg" : "/assets/verified.svg"} className="size-6" />{paymentMethod === "PAYMONGO_GCASH" ? "Continue to GCash" : "Confirm Reservation"}</Button></>
              )}
            </footer>
          </form>
        ) : items.length ? (
          <>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 sm:p-5">
              {items.map((item) => {
                const limit = productPurchaseLimit(item.product, 10, item.selectedOptions);
                const selectedAvailability = selectedProductAvailability(item.product, item.selectedOptions);
                const unavailable = isProductUnavailable(item.product) || limit === 0;
                return (
                  <article key={item.id} className="grid grid-cols-[82px_1fr] gap-3 rounded-lg border border-[#dfe7e0] p-3">
                    <div className="relative h-20 overflow-hidden rounded-md bg-[#eef5ee]">
                      <Image src={item.product.image} alt={item.product.name} fill sizes="82px" className="object-contain p-2" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0">
                          <h3 className="truncate font-bold text-[#17211b]">{item.product.name}</h3>
                          <p className="text-xs text-[#69746e]">{item.product.detail}</p>
                          {(item.product.saleMode === "OPTIONS" || (!item.product.saleMode && !isUniformClothOnly(item.product))) && Object.keys(item.selectedOptions).length ? (
                            <p className="mt-1 text-xs font-semibold leading-5 text-primary">{formatSelectedOptions(item.selectedOptions)}</p>
                          ) : null}
                          {isUniformClothOnly(item.product) ? (
                            <p className="mt-1 rounded bg-[#f3faf4] px-2 py-1 text-xs font-semibold text-primary">Tela/material only</p>
                          ) : null}
                          <p className="mt-1 font-extrabold text-primary">{item.product.price}</p>
                          {unavailable ? (
                            <p className="mt-1 text-xs font-extrabold text-[#a75a00]">Currently unavailable</p>
                          ) : (
                            <p className="mt-1 text-xs font-semibold text-[#5f6d64]">
                              {selectedAvailability} available · {Math.max(0, selectedAvailability - item.quantity)} remaining after reservation
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => removeItem(item.id)}
                          aria-label={`Remove ${item.product.name}`}
                          className="ml-auto grid size-8 shrink-0 place-items-center rounded-md text-[#9b3131] hover:bg-[#fff0f0]"
                        >
                          <AssetIcon src="/assets/delete.svg" className="size-5" />
                        </button>
                      </div>
                      <div className="mt-3 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => updateQuantity(item.id, item.quantity - 1)}
                          disabled={unavailable || item.quantity === 1}
                          className="grid size-8 place-items-center rounded-md border border-[#d3ddd4] disabled:opacity-40"
                          aria-label={`Decrease ${item.product.name} quantity`}
                        >
                          <Minus className="size-3.5" />
                        </button>
                        <span className="grid h-8 min-w-10 place-items-center rounded-md border border-[#d3ddd4] text-sm font-bold">{item.quantity}</span>
                        <button
                          type="button"
                          onClick={() => updateQuantity(item.id, item.quantity + 1)}
                          disabled={unavailable || item.quantity >= limit}
                          className="grid size-8 place-items-center rounded-md border border-[#d3ddd4] disabled:opacity-40"
                          aria-label={`Increase ${item.product.name} quantity`}
                        >
                          <Plus className="size-3.5" />
                        </button>
                        <span className="ml-auto text-sm font-extrabold text-[#253029]">
                          {formatPrice(parsePrice(item.product.price) * item.quantity)}
                        </span>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
            <footer className="shrink-0 border-t border-[#e4ebe5] p-5 sm:p-6">
              {hasUnavailableItems ? (
                <p className="mb-4 rounded-md border border-[#ead7a5] bg-[#fff9e9] px-3 py-2 text-sm font-semibold text-[#775300]" role="alert">
                  Remove unavailable items before checkout.
                </p>
              ) : null}
              <div className="mb-4 flex items-end justify-between gap-4">
                <div>
                  <p className="text-sm font-bold text-[#253029]">Cart total</p>
                  <p className="text-xs text-[#6d7771]">Choose pickup or online payment at checkout</p>
                </div>
                <p className="text-2xl font-extrabold text-primary">{formatPrice(total)}</p>
              </div>
              <Button className="h-12 w-full text-base" onClick={startCheckout} disabled={isReservationRestricted || hasUnavailableItems}>
                <ShoppingBag className="size-5" />
                {hasUnavailableItems
                  ? "Remove Unavailable Items"
                  : isReservationRestricted
                    ? "Reservation Access Paused"
                    : user
                      ? "Checkout Cart"
                      : "Log in to Checkout"}
              </Button>
              {restrictionSummary?.activeRestriction ? (
                <p className="mt-3 text-center text-xs leading-5 text-[#8f2222]">You can keep these items in your cart and contact Support for a review.</p>
              ) : null}
              <button type="button" onClick={clearCart} className="mt-3 w-full text-sm font-semibold text-[#8f3131] hover:underline">
                Clear cart
              </button>
            </footer>
          </>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
            <AssetIcon src="/assets/cart.svg" className="size-20" />
            <h3 className="mt-4 text-xl font-extrabold text-[#17211b]">Your cart is empty</h3>
            <p className="mt-2 text-sm leading-6 text-[#657169]">Add available campus items, then reserve them with one pickup schedule.</p>
            <Link href="/student/shop" className="mt-5" onClick={closeCart}>
              <Button>Browse Items</Button>
            </Link>
          </div>
        )}
      </aside>
    </div>,
    document.body
  );
}
