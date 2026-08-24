"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeft,
  Minus,
  Plus,
  X
} from "lucide-react";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import {
  PaymentMethodSelector,
  type StudentCheckoutPaymentMethod
} from "@/components/checkout/PaymentMethodSelector";
import { useStudentRestriction } from "@/components/restrictions/StudentRestrictionProvider";
import { ActionLoadingOverlay } from "@/components/ui/ActionLoadingOverlay";
import { AssetIcon } from "@/components/ui/AssetIcon";
import { Button } from "@/components/ui/button";
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

function parsePrice(price: string) {
  return Number(price.replace(/[^0-9.]/g, ""));
}

function formatPrice(value: number) {
  return `PHP ${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getManilaDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function getFutureDate(days: number) {
  return getManilaDateKey(new Date(Date.now() + days * 24 * 60 * 60 * 1000));
}

function formatSelections(options: Record<string, string>) {
  return Object.entries(options).map(([name, value]) => `${name}: ${value}`).join(", ");
}

function getPickupWindow(date: string, time: string) {
  const windows: Record<string, [string, string]> = {
    "8:00 AM - 10:00 AM": ["08:00", "10:00"],
    "10:00 AM - 12:00 PM": ["10:00", "12:00"],
    "1:00 PM - 3:00 PM": ["13:00", "15:00"],
    "3:00 PM - 5:00 PM": ["15:00", "17:00"]
  };
  const [start, end] = windows[time] ?? windows["10:00 AM - 12:00 PM"];

  return {
    pickupStart: new Date(`${date}T${start}:00+08:00`).toISOString(),
    pickupEnd: new Date(`${date}T${end}:00+08:00`).toISOString()
  };
}

export function StudentCheckoutModal({
  product,
  relatedProducts = [],
  onSwitchProduct,
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
  const [quantity, setQuantity] = useState(1);
  const [pickupDate, setPickupDate] = useState("");
  const [pickupTime, setPickupTime] = useState("10:00 AM - 12:00 PM");
  const [paymentMethod, setPaymentMethod] = useState<StudentCheckoutPaymentMethod>("PAY_AT_COMMISSARY");
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
  const pendingRequestRef = useRef<PendingReservationRequest | null>(null);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    submittingRef.current = submitting;
  }, [submitting]);

  useEffect(() => {
    if (!product) return;

    setQuantity(1);
    setPickupDate(getFutureDate(1));
    setPickupTime("10:00 AM - 12:00 PM");
    setPaymentMethod("PAY_AT_COMMISSARY");
    setNotes("");
    setSelectedOptions({});
    setError("");
    setReference("");
    setGcashRecovery(null);
    setSubmitting(false);
    pendingRequestRef.current = null;

    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submittingRef.current) onClose();
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [product, onClose]);

  const unitPrice = product ? parsePrice(product.price) : 0;
  const stockCount = product ? productStockCount(product) : 0;
  const selectionsComplete = product ? hasCompleteProductSelections(product, selectedOptions) : false;
  const stockUnavailable = product ? isProductUnavailable(product) : true;
  const maxQuantity = product ? productPurchaseLimit(product, 10, selectedOptions) : 0;
  const selectedAvailability = product ? selectedProductAvailability(product, selectedOptions) : 0;
  const unavailable = stockUnavailable || !selectionsComplete || maxQuantity === 0;
  const total = useMemo(() => unitPrice * quantity, [quantity, unitPrice]);
  const clothOnly = product ? isUniformClothOnly(product) : false;

  useEffect(() => {
    if (maxQuantity > 0) setQuantity((current) => Math.min(current, maxQuantity));
  }, [maxQuantity]);

  const openGcashCheckout = async (reservation: Pick<BackendReservation, "id" | "referenceCode">) => {
    if (!user?.accessToken) throw new Error("Please sign in again to continue.");

    const checkout = await createGcashCheckoutFromApi(
      user.accessToken,
      reservation.id,
      getPaymentIdempotencyKey(reservation.id)
    );
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
      setError(paymentError instanceof Error ? paymentError.message : "Unable to open GCash payment.");
    } finally {
      setSubmitting(false);
    }
  };

  const confirmReservation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    if (!user) {
      openAuth();
      return;
    }
    if (isReservationRestricted) {
      setError("Your reservation access is currently paused. You can still browse items and contact Support for assistance.");
      return;
    }
    if (!product) return;
    if (stockUnavailable) {
      setError("This item is currently out of stock. Return to the shop and add it to your wishlist for a restock alert.");
      return;
    }
    if (!selectionsComplete) {
      setError("Select all required item options before continuing.");
      return;
    }
    if (!pickupDate) {
      setError("Select your preferred pickup date.");
      return;
    }
    if (pickupDate < getFutureDate(1)) {
      setError("Pickup must be scheduled at least one day in advance.");
      return;
    }
    if (!product.id) {
      setError("Refresh the shop so this item can be reserved from the live inventory.");
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
      ...getPickupWindow(pickupDate, pickupTime),
      items: [
        {
          productId: product.id,
          ...(skuId ? { skuId } : {}),
          variantSummary,
          quantity
        }
      ]
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
      setError(reservationError instanceof Error ? reservationError.message : "Unable to submit reservation.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!mounted || !product) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9000] grid place-items-center overflow-y-auto bg-[#101820]/55 p-3 backdrop-blur-[2px] sm:p-6"
      role="presentation"
      onMouseDown={(event) => {
        if (!submitting && event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="checkout-title"
        className="relative w-full max-w-[980px] overflow-hidden rounded-lg border border-[#dce6dc] bg-white shadow-[0_28px_90px_rgba(0,0,0,0.25)]"
      >
        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          aria-label="Close checkout"
          className="absolute right-4 top-4 z-20 grid size-10 place-items-center rounded-md border border-[#dce6dc] bg-white text-[#25322b] shadow-sm transition hover:bg-[#eef6ee]"
        >
          <X className="size-5" />
        </button>

        {gcashRecovery ? (
          <div className="flex min-h-[560px] flex-col items-center justify-center px-6 py-16 text-center">
            <span className="grid size-20 place-items-center rounded-full bg-[#fff4c8] text-[#8a6500]">
              <AssetIcon src="/assets/e-wallet.svg" className="size-14" />
            </span>
            <p className="mt-6 text-sm font-bold uppercase text-primary">Reservation saved</p>
            <h1 id="checkout-title" className="mt-2 text-3xl font-extrabold text-[#101820] sm:text-4xl">
              Complete your GCash payment
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-[#657169]">{gcashRecovery.message}</p>
            <div className="mt-7 rounded-lg border border-[#cfe0d0] bg-[#f5faf5] px-7 py-5">
              <p className="text-xs font-bold uppercase text-[#6b766f]">Reservation reference</p>
              <p className="mt-1 text-2xl font-extrabold text-primary">{gcashRecovery.referenceCode}</p>
            </div>
            {error ? (
              <p tabIndex={-1} className="mt-4 max-w-xl rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700" role="alert">
                {error}
              </p>
            ) : null}
            <div className="mt-8 flex w-full max-w-md flex-col gap-3 sm:flex-row">
              <Link href="/student/reservations" className="flex-1" onClick={onClose}>
                <Button variant="secondary" className="h-12 w-full">View Reservation</Button>
              </Link>
              <Button className="h-12 flex-1" onClick={() => void continueGcashPayment()} disabled={submitting} aria-busy={submitting}>
                <AssetIcon src="/assets/e-wallet.svg" className="size-6" />
                {submitting ? "Opening GCash..." : "Continue Payment"}
              </Button>
            </div>
          </div>
        ) : reference ? (
          <div className="flex min-h-[560px] flex-col items-center justify-center px-6 py-16 text-center">
            <span className="grid size-20 place-items-center rounded-full bg-[#e5f3e6] text-primary">
              <AssetIcon src="/assets/confirmed.svg" className="size-14" />
            </span>
            <p className="mt-6 text-sm font-bold uppercase text-primary">Reservation submitted</p>
            <h1 id="checkout-title" className="mt-2 text-3xl font-extrabold text-[#101820] sm:text-4xl">
              Your item is awaiting confirmation
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-[#657169]">
              Commissary staff will review the stock and pickup schedule. Payment will be collected using your selected method during pickup.
            </p>
            <div className="mt-7 rounded-lg border border-[#cfe0d0] bg-[#f5faf5] px-7 py-5">
              <p className="text-xs font-bold uppercase text-[#6b766f]">Reservation reference</p>
              <p className="mt-1 text-2xl font-extrabold text-primary">{reference}</p>
            </div>
            <div className="mt-8 flex w-full max-w-md flex-col gap-3 sm:flex-row">
              <Button variant="secondary" className="h-12 flex-1" onClick={onClose}>
                <ChevronLeft className="size-4" />
                Continue Shopping
              </Button>
              <Link href="/student/reservations" className="flex-1" onClick={onClose}>
                <Button className="h-12 w-full">
                  <AssetIcon src="/assets/my-reservations.svg" className="size-6" />
                  My Reservations
                </Button>
              </Link>
            </div>
          </div>
        ) : (
          <form className="relative" onSubmit={confirmReservation}>
            <ActionLoadingOverlay
              active={submitting}
              title="Submitting your reservation"
              detail="We are checking stock and saving your pickup schedule."
            />
            <div className="border-b border-[#e6ece6] px-5 pb-5 pt-6 sm:px-8">
              <p className="text-sm font-bold uppercase text-primary">Item checkout</p>
              <h1 id="checkout-title" className="mt-1 pr-12 text-2xl font-extrabold text-[#101820] sm:text-3xl">
                {clothOnly ? "Review and reserve your cloth item" : "Review and reserve your item"}
              </h1>
              <p className="mt-2 text-sm text-[#667169]">Confirm the item details and choose when you will pick it up.</p>
            </div>

            <div className="grid max-h-[calc(100svh-150px)] overflow-y-auto lg:grid-cols-[1.05fr_0.95fr]">
              <div className="space-y-6 p-5 sm:p-8">
                <section className="grid gap-5 rounded-lg border border-[#dfe7e0] bg-[#fbfdfb] p-4 sm:grid-cols-[150px_1fr]">
                  <div className="relative h-36 overflow-hidden rounded-md bg-[#eef5ee]">
                    <Image src={product.image} alt={product.name} fill sizes="150px" className="object-contain p-3" />
                  </div>
                  <div className="min-w-0">
                    <span className="inline-flex rounded-full bg-[#e1f2e3] px-3 py-1 text-xs font-bold text-primary">{product.status}</span>
                    <h2 className="mt-3 text-xl font-extrabold text-[#17211b]">{product.name}</h2>
                    <p className="mt-1 text-sm text-[#69746e]">{product.detail}</p>
                    <p className="mt-1 text-xs font-bold uppercase text-primary">{product.category}</p>
                    <div className="mt-3 flex items-center gap-2">
                      <p className="text-xl font-extrabold text-primary">{product.price}</p>
                      {product.oldPrice ? <p className="text-sm text-[#879089] line-through">{product.oldPrice}</p> : null}
                    </div>
                    <p className="mt-1 text-xs text-[#69746e]">{stockCount} items currently available</p>
                  </div>
                </section>

                {clothOnly ? (
                  <section className="rounded-lg border border-[#bdd8c0] bg-[#f3faf4] p-4">
                    <div className="flex items-start gap-3">
                      <AssetIcon src="/assets/uniforms.svg" className="size-9 shrink-0" />
                      <div>
                        <p className="font-extrabold text-primary">Uniform cloth only</p>
                        <p className="mt-1 text-sm leading-6 text-[#4e6255]">{UNIFORM_CLOTH_NOTICE}</p>
                        <p className="mt-1 text-xs font-semibold text-[#667169]">The commissary sells the tela/material; tailoring or sewing is handled separately.</p>
                      </div>
                    </div>
                  </section>
                ) : null}

                {clothOnly && relatedProducts.length ? (
                  <section className="rounded-lg border border-[#dfe7e0] bg-white p-4">
                    <p className="font-extrabold text-[#17211b]">Related cloth previews</p>
                    <p className="mt-1 text-xs text-[#6d7771]">Grouped here so you can compare related cloth items before checkout.</p>
                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {relatedProducts.map((item) => (
                        <button
                          key={item.id || item.name}
                          type="button"
                          disabled={submitting}
                          onClick={() => onSwitchProduct?.(item)}
                          className="rounded-md border border-[#dfe7e0] p-2 text-left transition hover:border-primary hover:bg-[#f5faf5] disabled:opacity-60"
                        >
                          <span className="relative block h-20 rounded bg-[#f0f6f1]">
                            <Image src={item.image} alt="" fill sizes="120px" className="object-contain p-2" />
                          </span>
                          <span className="mt-2 line-clamp-2 block min-h-9 text-xs font-bold text-[#17211b]">{item.name}</span>
                          <span className="mt-1 block text-xs font-extrabold text-primary">{item.price}</span>
                        </button>
                      ))}
                    </div>
                  </section>
                ) : null}

                {product.options.length ? (
                  <section className="space-y-5">
                    {product.options.map((option) => (
                      <fieldset key={option.name}>
                        <legend className="font-extrabold text-[#17211b]">{option.name}</legend>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {option.values.map((value) => {
                            const valueStock = productOptionValueStock(product, option.name, value, selectedOptions);
                            const valueUnavailable = valueStock === 0;
                            return (
                              <button
                                key={value}
                                type="button"
                                disabled={submitting || valueUnavailable}
                                onClick={() => setSelectedOptions((current) => {
                                  if (current[option.name] === value) {
                                    const next = { ...current };
                                    delete next[option.name];
                                    return next;
                                  }
                                  return { ...current, [option.name]: value };
                                })}
                                className={`min-h-10 rounded-md border px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:border-[#e1e5e2] disabled:bg-[#f3f4f3] disabled:text-[#9aa29d] ${
                                  selectedOptions[option.name] === value
                                    ? "border-primary bg-[#e8f4e8] text-primary ring-1 ring-primary"
                                    : "border-[#d5ded6] bg-white hover:border-[#a9bfab]"
                                }`}
                              >
                                {value}{valueUnavailable ? " — Out of stock" : valueStock !== null ? ` (${valueStock} available)` : ""}
                              </button>
                            );
                          })}
                        </div>
                      </fieldset>
                    ))}
                  </section>
                ) : null}

                <section>
                  <h2 className="flex items-center gap-2 font-extrabold text-[#17211b]">
                    <AssetIcon src="/assets/orders.svg" className="size-7" />
                    Quantity
                  </h2>
                  <div className="mt-3 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setQuantity((current) => Math.max(1, current - 1))}
                      disabled={submitting || unavailable || quantity === 1}
                      aria-label="Decrease quantity"
                      className="grid size-10 place-items-center rounded-md border border-[#cfdacf] text-primary hover:bg-[#eef6ee] disabled:opacity-40"
                    >
                      <Minus className="size-4" />
                    </button>
                    <span className="grid h-10 min-w-14 place-items-center rounded-md border border-[#d7e0d8] bg-white px-4 font-extrabold">{quantity}</span>
                    <button
                      type="button"
                      onClick={() => setQuantity((current) => Math.min(maxQuantity, current + 1))}
                      disabled={submitting || unavailable || quantity >= maxQuantity}
                      aria-label="Increase quantity"
                      className="grid size-10 place-items-center rounded-md border border-[#cfdacf] text-primary hover:bg-[#eef6ee] disabled:opacity-40"
                    >
                      <Plus className="size-4" />
                    </button>
                    <span className="text-xs text-[#69746e]">
                      {stockUnavailable
                        ? "This item is currently unavailable"
                        : !selectionsComplete
                          ? "Choose the required item option first"
                          : `${selectedAvailability} available · ${Math.max(0, selectedAvailability - quantity)} remaining after reservation`}
                    </span>
                  </div>
                </section>

                <section>
                  <h2 className="flex items-center gap-2 font-extrabold text-[#17211b]">
                    <AssetIcon src="/assets/pick-up.svg" className="size-7" />
                    Pickup schedule
                  </h2>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-1.5 text-sm font-semibold">
                      Pickup date
                      <input
                        required
                        type="date"
                        min={getFutureDate(1)}
                        value={pickupDate}
                        onChange={(event) => {
                          setPickupDate(event.target.value);
                          setError("");
                        }}
                        disabled={submitting}
                        className="h-11 rounded-md border border-[#cfdacf] bg-white px-3 outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
                      />
                    </label>
                    <label className="grid gap-1.5 text-sm font-semibold">
                      Pickup time
                      <select
                        value={pickupTime}
                        onChange={(event) => setPickupTime(event.target.value)}
                        disabled={submitting}
                        className="h-11 rounded-md border border-[#cfdacf] bg-white px-3 outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
                      >
                        <option>8:00 AM - 10:00 AM</option>
                        <option>10:00 AM - 12:00 PM</option>
                        <option>1:00 PM - 3:00 PM</option>
                        <option>3:00 PM - 5:00 PM</option>
                      </select>
                    </label>
                  </div>
                </section>

                <label className="grid gap-1.5 text-sm font-semibold">
                  Notes for commissary staff <span className="font-normal text-[#7b857f]">(optional)</span>
                  <textarea
                    value={notes}
                    maxLength={180}
                    onChange={(event) => setNotes(event.target.value)}
                    disabled={submitting}
                    placeholder="Size, color, or other pickup details"
                    className="min-h-20 rounded-md border border-[#cfdacf] bg-white px-3 py-2 text-sm font-normal outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
                  />
                </label>
              </div>

              <aside className="border-t border-[#e6ece6] bg-[#f7faf7] p-5 sm:p-8 lg:border-l lg:border-t-0">
                <h2 className="text-xl font-extrabold text-[#17211b]">Reservation summary</h2>

                <div className="mt-5 space-y-3 border-b border-[#dce4dc] pb-5 text-sm">
                  <div className="flex justify-between gap-4">
                    <span className="text-[#657169]">Item price</span>
                    <span className="font-semibold">{formatPrice(unitPrice)}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-[#657169]">Quantity</span>
                    <span className="font-semibold">x{quantity}</span>
                  </div>
                  {Object.keys(selectedOptions).length ? (
                    <div className="flex justify-between gap-4">
                      <span className="text-[#657169]">Item details</span>
                      <span className="max-w-[60%] text-right font-semibold">{formatSelections(selectedOptions)}</span>
                    </div>
                  ) : null}
                  <div className="flex justify-between gap-4">
                    <span className="text-[#657169]">Reservation fee</span>
                    <span className="font-semibold text-primary">Free</span>
                  </div>
                </div>
                <div className="flex items-end justify-between gap-4 py-5">
                  <span className="font-bold text-[#253029]">
                    {paymentMethod === "PAYMONGO_GCASH" ? "Total to pay online" : "Total at pickup"}
                  </span>
                  <span className="text-2xl font-extrabold text-primary">{formatPrice(total)}</span>
                </div>

                <div className="border-t border-[#dce4dc] pt-5">
                  <PaymentMethodSelector
                    name="payment"
                    value={paymentMethod}
                    onChange={setPaymentMethod}
                    disabled={submitting}
                  />
                </div>

                {error ? (
                  <p className="mt-4 rounded-md border border-[#f0b9b9] bg-[#fff3f3] px-3 py-2.5 text-sm font-medium text-[#a22828]" role="alert">
                    {error}
                  </p>
                ) : null}

                {restrictionSummary?.activeRestriction ? (
                  <p className="mt-4 rounded-md border border-[#e6b8b8] bg-[#fff7f7] px-3 py-2.5 text-sm leading-6 text-[#8f2222]" role="alert">
                    <strong>Reservation access is paused.</strong> {restrictionSummary.activeRestriction.reason} Contact Support if you need this reviewed.
                  </p>
                ) : null}

                {!user ? (
                  <p className="mt-4 rounded-md border border-[#ead7a5] bg-[#fff9e9] px-3 py-2.5 text-sm text-[#775300]">
                    Log in with your Wesleyan account before confirming this reservation.
                  </p>
                ) : (
                  <p className="mt-4 text-xs leading-5 text-[#69746e]">
                    Reserving as <strong>{user.email}</strong>
                  </p>
                )}

                <Button type="submit" disabled={submitting || isReservationRestricted || unavailable} aria-busy={submitting} className="mt-5 h-12 w-full text-base font-bold">
                  <AssetIcon src="/assets/verified.svg" className="size-6" />
                  {submitting
                    ? "Submitting reservation..."
                    : stockUnavailable
                      ? "Out of Stock"
                      : !selectionsComplete
                        ? "Select Options"
                      : isReservationRestricted
                      ? "Reservation Access Paused"
                      : user
                        ? paymentMethod === "PAYMONGO_GCASH" ? "Continue to GCash" : "Confirm Reservation"
                        : "Log in to Continue"}
                </Button>
                <p className="mt-3 text-center text-xs leading-5 text-[#77817b]">
                  {paymentMethod === "PAYMONGO_GCASH"
                    ? "WESCOMM marks payment complete only after secure confirmation from PayMongo."
                    : "No payment is charged online. Staff confirmation is required before pickup."}
                </p>
              </aside>
            </div>
          </form>
        )}
      </section>
    </div>,
    document.body
  );
}
