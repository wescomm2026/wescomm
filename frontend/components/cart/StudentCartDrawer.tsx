"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Minus, Plus, ShoppingBag, X } from "lucide-react";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import { useStudentCart } from "@/components/cart/StudentCartProvider";
import { useStudentRestriction } from "@/components/restrictions/StudentRestrictionProvider";
import { ActionLoadingOverlay } from "@/components/ui/ActionLoadingOverlay";
import { AssetIcon } from "@/components/ui/AssetIcon";
import { Button } from "@/components/ui/button";
import { BackendApiError, createReservationFromApi, type BackendPaymentMethod } from "@/lib/api";
import {
  isProductUnavailable,
  isUniformClothOnly,
  productPurchaseLimit,
  UNIFORM_CLOTH_NOTICE
} from "@/lib/product-display";
import {
  getReservationRequestIdentity,
  type PendingReservationRequest
} from "@/lib/reservation-idempotency";

function parsePrice(price: string) {
  return Number(price.replace(/[^0-9.]/g, ""));
}

function formatPrice(value: number) {
  return `PHP ${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getFutureDate(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatSelectedOptions(options: Record<string, string>) {
  return Object.entries(options)
    .map(([name, value]) => `${name}: ${value}`)
    .join(", ");
}

function mapPaymentMethod(value: string): BackendPaymentMethod {
  if (value === "E-wallet at Pickup") return "E_WALLET_AT_PICKUP";
  return "PAY_AT_COMMISSARY";
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

export function StudentCartDrawer() {
  const { items, itemCount, open, closeCart, updateQuantity, removeItem, clearCart } = useStudentCart();
  const { user, openAuth } = useStudentAuth();
  const { summary: restrictionSummary, isReservationRestricted } = useStudentRestriction();
  const [mounted, setMounted] = useState(false);
  const [checkout, setCheckout] = useState(false);
  const [pickupDate, setPickupDate] = useState("");
  const [pickupTime, setPickupTime] = useState("10:00 AM - 12:00 PM");
  const [paymentMethod, setPaymentMethod] = useState("Pay at Commissary");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [reference, setReference] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const pendingRequestRef = useRef<PendingReservationRequest | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) closeCart();
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, closeCart, submitting]);

  useEffect(() => {
    if (!open) {
      setCheckout(false);
      setPickupDate("");
      setPickupTime("10:00 AM - 12:00 PM");
      setPaymentMethod("Pay at Commissary");
      setNotes("");
      setError("");
      setReference("");
      setSubmitting(false);
      pendingRequestRef.current = null;
    }
  }, [open]);

  const total = useMemo(
    () => items.reduce((sum, item) => sum + parsePrice(item.product.price) * item.quantity, 0),
    [items]
  );
  const unavailableItems = useMemo(
    () => items.filter((item) => isProductUnavailable(item.product)),
    [items]
  );
  const hasUnavailableItems = unavailableItems.length > 0;

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
    setPickupDate(getFutureDate(1));
    setCheckout(true);
    setError("");
  };

  const confirmCart = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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
    if (!pickupDate || pickupDate < getFutureDate(1)) {
      setError("Select a pickup date at least one day in advance.");
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
      paymentMethod: mapPaymentMethod(paymentMethod),
      ...getPickupWindow(pickupDate, pickupTime),
      items: items.map((item) => {
        const selectedOptions = formatSelectedOptions(item.selectedOptions);
        const noteDetails = notes.trim();
        const variantSummary = [selectedOptions, noteDetails ? `Note: ${noteDetails}` : ""].filter(Boolean).join(" | ");

        return {
          productId: item.product.id!,
          variantSummary,
          quantity: item.quantity
        };
      })
    };
    const requestIdentity = getReservationRequestIdentity(payload, pendingRequestRef.current);
    pendingRequestRef.current = requestIdentity;

    setSubmitting(true);
    try {
      const reservation = await createReservationFromApi(user.accessToken, payload, requestIdentity.key);

      clearCart();
      setReference(reservation.referenceCode);
      pendingRequestRef.current = null;
      window.dispatchEvent(new Event("wescomm:products-refresh"));
    } catch (reservationError) {
      if (reservationError instanceof BackendApiError && reservationError.code === "RESERVATION_ACCESS_SUSPENDED") {
        window.dispatchEvent(new Event("wescomm:restriction-refresh"));
      }
      setError(reservationError instanceof Error ? reservationError.message : "Unable to submit cart reservation.");
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
        role="dialog"
        aria-modal="true"
        aria-labelledby="student-cart-title"
        className="relative ml-auto flex h-[100svh] w-full max-w-[520px] flex-col bg-white shadow-[-24px_0_70px_rgba(0,0,0,0.22)]"
      >
        <header className="flex h-20 shrink-0 items-center border-b border-[#e4ebe5] px-5 sm:px-6">
          <AssetIcon src="/assets/cart.svg" className="size-9" />
          <div className="ml-3">
            <h2 id="student-cart-title" className="text-xl font-extrabold text-[#17211b]">
              {checkout ? "Cart Checkout" : "My Cart"}
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

        {reference ? (
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
            <ActionLoadingOverlay
              active={submitting}
              title="Submitting cart reservation"
              detail="We are checking each item and saving one pickup schedule."
            />
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5 sm:p-6">
              <section className="rounded-md border border-[#dce5dd] bg-[#f7faf7] p-4">
                <p className="text-sm font-bold text-[#253029]">{items.length} product{items.length === 1 ? "" : "s"} in this reservation</p>
                <p className="mt-1 text-2xl font-extrabold text-primary">{formatPrice(total)}</p>
                <p className="mt-1 text-xs text-[#6c7770]">Total payment at pickup</p>
              </section>

              {hasUnavailableItems ? (
                <p className="rounded-md border border-[#ead7a5] bg-[#fff9e9] px-3 py-2 text-sm font-semibold text-[#775300]" role="alert">
                  One or more cart items are no longer available. Go back and remove them before confirming.
                </p>
              ) : null}

              {items.some((item) => isUniformClothOnly(item.product)) ? (
                <section className="rounded-md border border-[#bdd8c0] bg-[#f3faf4] p-4">
                  <div className="flex items-start gap-3">
                    <AssetIcon src="/assets/uniforms.svg" className="size-8 shrink-0" />
                    <div>
                      <p className="font-extrabold text-primary">Uniform cloth only</p>
                      <p className="mt-1 text-sm leading-6 text-[#4e6255]">{UNIFORM_CLOTH_NOTICE}</p>
                    </div>
                  </div>
                </section>
              ) : null}

              <section>
                <h3 className="flex items-center gap-2 font-extrabold text-[#17211b]">
                  <AssetIcon src="/assets/pick-up.svg" className="size-7" />
                  Pickup schedule
                </h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1.5 text-sm font-semibold">
                    Date
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
                      className="h-11 rounded-md border border-[#cfdacf] px-3 outline-none focus:border-primary"
                    />
                  </label>
                  <label className="grid gap-1.5 text-sm font-semibold">
                    Time
                    <select
                      value={pickupTime}
                      onChange={(event) => setPickupTime(event.target.value)}
                      disabled={submitting}
                      className="h-11 rounded-md border border-[#cfdacf] bg-white px-3 outline-none focus:border-primary"
                    >
                      <option>8:00 AM - 10:00 AM</option>
                      <option>10:00 AM - 12:00 PM</option>
                      <option>1:00 PM - 3:00 PM</option>
                      <option>3:00 PM - 5:00 PM</option>
                    </select>
                  </label>
                </div>
              </section>

              <fieldset>
                <legend className="flex items-center gap-2 font-extrabold text-[#17211b]">
                  <AssetIcon src="/assets/payment.svg" className="size-7" />
                  Payment at pickup
                </legend>
                <div className="mt-3 grid gap-2">
                  {[
                    { value: "Pay at Commissary", detail: "Cash at the counter", image: "/assets/cash.svg" },
                    { value: "E-wallet at Pickup", detail: "Official QR at the counter", image: "/assets/e-wallet.svg" }
                  ].map((method) => (
                    <label
                      key={method.value}
                      className={`flex cursor-pointer items-center gap-3 rounded-md border p-3 ${
                        paymentMethod === method.value ? "border-primary bg-[#edf6ed]" : "border-[#d7e0d8]"
                      }`}
                    >
                      <input
                        type="radio"
                        name="cart-payment"
                        checked={paymentMethod === method.value}
                        onChange={() => setPaymentMethod(method.value)}
                        disabled={submitting}
                        className="accent-primary"
                      />
                      <AssetIcon src={method.image} className="size-7" />
                      <span>
                        <span className="block text-sm font-bold">{method.value}</span>
                        <span className="block text-xs text-[#6d7771]">{method.detail}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <label className="grid gap-1.5 text-sm font-semibold">
                Notes <span className="font-normal text-[#78827c]">(optional)</span>
                <textarea
                  value={notes}
                  maxLength={180}
                  onChange={(event) => setNotes(event.target.value)}
                  disabled={submitting}
                  className="min-h-20 rounded-md border border-[#cfdacf] px-3 py-2 font-normal outline-none focus:border-primary"
                  placeholder="Pickup details for commissary staff"
                />
              </label>

              {error ? (
                <p className="rounded-md border border-[#f0b9b9] bg-[#fff3f3] px-3 py-2 text-sm font-medium text-[#a22828]">{error}</p>
              ) : null}

              {restrictionSummary?.activeRestriction ? (
                <p className="rounded-md border border-[#e6b8b8] bg-[#fff7f7] px-3 py-2 text-sm leading-6 text-[#8f2222]">
                  <strong>Reservation access is paused.</strong> {restrictionSummary.activeRestriction.reason}
                </p>
              ) : null}
            </div>
            <footer className="grid shrink-0 grid-cols-2 gap-3 border-t border-[#e4ebe5] p-5 sm:p-6">
              <Button type="button" variant="secondary" className="h-12" onClick={() => setCheckout(false)} disabled={submitting}>
                Back to Cart
              </Button>
              <Button type="submit" disabled={submitting || isReservationRestricted || hasUnavailableItems} className="h-12">
                <AssetIcon src="/assets/verified.svg" className="size-6" />
                {submitting ? "Submitting..." : isReservationRestricted ? "Access Paused" : "Confirm"}
              </Button>
            </footer>
          </form>
        ) : items.length ? (
          <>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 sm:p-5">
              {items.map((item) => {
                const limit = productPurchaseLimit(item.product);
                const unavailable = isProductUnavailable(item.product);
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
                          {Object.keys(item.selectedOptions).length ? (
                            <p className="mt-1 text-xs font-semibold leading-5 text-primary">{formatSelectedOptions(item.selectedOptions)}</p>
                          ) : null}
                          {isUniformClothOnly(item.product) ? (
                            <p className="mt-1 rounded bg-[#f3faf4] px-2 py-1 text-xs font-semibold text-primary">Tela/material only</p>
                          ) : null}
                          <p className="mt-1 font-extrabold text-primary">{item.product.price}</p>
                          {unavailable ? (
                            <p className="mt-1 text-xs font-extrabold text-[#a75a00]">Currently unavailable</p>
                          ) : null}
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
                  <p className="text-xs text-[#6d7771]">Payment during pickup</p>
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
