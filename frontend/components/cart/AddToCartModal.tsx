"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Minus, Plus, X } from "lucide-react";
import type { CartProduct } from "@/components/cart/StudentCartProvider";
import { AssetIcon } from "@/components/ui/AssetIcon";
import { Button } from "@/components/ui/button";
import {
  isProductUnavailable,
  isUniformClothOnly,
  productPurchaseLimit,
  UNIFORM_CLOTH_NOTICE
} from "@/lib/product-display";

function parsePrice(price: string) {
  return Number(price.replace(/[^0-9.]/g, ""));
}

function formatPrice(value: number) {
  return `PHP ${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function defaultSelections(product: CartProduct) {
  return Object.fromEntries(product.options.map((option) => [option.name, option.values[0] ?? ""]));
}

export function AddToCartModal({
  product,
  relatedProducts = [],
  onSwitchProduct,
  onClose,
  onConfirm
}: {
  product: CartProduct | null;
  relatedProducts?: CartProduct[];
  onSwitchProduct?: (product: CartProduct) => void;
  onClose: () => void;
  onConfirm: (product: CartProduct, selectedOptions: Record<string, string>, quantity: number) => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({});
  const [quantity, setQuantity] = useState(1);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!product) return;
    setSelectedOptions(defaultSelections(product));
    setQuantity(1);

    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [product, onClose]);

  const limit = product ? productPurchaseLimit(product) : 0;
  const unavailable = product ? isProductUnavailable(product) : true;
  const total = useMemo(() => (product ? parsePrice(product.price) * quantity : 0), [product, quantity]);
  const clothOnly = product ? isUniformClothOnly(product) : false;

  if (!mounted || !product) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9000] grid place-items-center overflow-y-auto bg-[#101820]/55 p-3 backdrop-blur-[2px] sm:p-6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-cart-title"
        className="relative w-full max-w-[680px] overflow-hidden rounded-lg border border-[#dce5dd] bg-white shadow-[0_28px_80px_rgba(0,0,0,0.24)]"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close item details"
          className="absolute right-4 top-4 z-10 grid size-10 place-items-center rounded-md border border-[#dce5dd] bg-white hover:bg-[#eef6ee]"
        >
          <X className="size-5" />
        </button>

        <header className="border-b border-[#e5ebe6] px-5 pb-5 pt-6 sm:px-7">
          <p className="text-sm font-bold uppercase text-primary">Item details</p>
          <h2 id="add-cart-title" className="mt-1 pr-12 text-2xl font-extrabold text-[#17211b]">
            {clothOnly ? "Choose your cloth item" : "Choose your item options"}
          </h2>
        </header>

        <div className="max-h-[calc(100svh-190px)] overflow-y-auto p-5 sm:p-7">
          <section className="grid gap-5 rounded-lg border border-[#dfe7e0] bg-[#fbfdfb] p-4 sm:grid-cols-[150px_1fr]">
            <div className="relative h-36 rounded-md bg-[#eef5ee]">
              <Image src={product.image} alt={product.name} fill sizes="150px" className="object-contain p-3" />
            </div>
            <div>
              <span className="inline-flex rounded-full bg-[#e1f2e3] px-3 py-1 text-xs font-bold text-primary">{product.status}</span>
              <h3 className="mt-3 text-xl font-extrabold text-[#17211b]">{product.name}</h3>
              <p className="mt-1 text-sm text-[#69746e]">{product.detail}</p>
              <p className="mt-1 text-xs font-bold uppercase text-primary">{product.category}</p>
              <p className="mt-3 text-xl font-extrabold text-primary">{product.price}</p>
            </div>
          </section>

          {clothOnly ? (
            <section className="mt-4 rounded-lg border border-[#bdd8c0] bg-[#f3faf4] p-4">
              <div className="flex items-start gap-3">
                <AssetIcon src="/assets/uniforms.svg" className="size-9 shrink-0" />
                <div>
                  <p className="font-extrabold text-primary">Uniform cloth only</p>
                  <p className="mt-1 text-sm leading-6 text-[#4e6255]">{UNIFORM_CLOTH_NOTICE}</p>
                </div>
              </div>
            </section>
          ) : null}

          {clothOnly && relatedProducts.length ? (
            <section className="mt-4 rounded-lg border border-[#dfe7e0] bg-white p-4">
              <p className="font-extrabold text-[#17211b]">Related cloth previews</p>
              <p className="mt-1 text-xs text-[#6d7771]">These are grouped here for easier comparison. Select one to switch the item in this modal.</p>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {relatedProducts.map((item) => (
                  <button
                    key={item.id || item.name}
                    type="button"
                    onClick={() => onSwitchProduct?.(item)}
                    className="rounded-md border border-[#dfe7e0] p-2 text-left transition hover:border-primary hover:bg-[#f5faf5]"
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
            <div className="mt-6 space-y-5">
              {product.options.map((option) => (
                <fieldset key={option.name}>
                  <legend className="text-sm font-extrabold text-[#253029]">{option.name}</legend>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {option.values.map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setSelectedOptions((current) => ({ ...current, [option.name]: value }))}
                        className={`min-h-10 rounded-md border px-4 text-sm font-semibold transition ${
                          selectedOptions[option.name] === value
                            ? "border-primary bg-[#e8f4e8] text-primary ring-1 ring-primary"
                            : "border-[#d5ded6] bg-white text-[#39443d] hover:border-[#a9bfab]"
                        }`}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                </fieldset>
              ))}
            </div>
          ) : null}

          <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-[#e4ebe5] pt-5">
            <div>
              <p className="text-sm font-extrabold text-[#253029]">Quantity</p>
              <p className="text-xs text-[#6d7771]">
                {unavailable ? "This item is currently unavailable" : `Maximum ${limit} per item option`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setQuantity((current) => Math.max(1, current - 1))}
                disabled={unavailable || quantity === 1}
                className="grid size-10 place-items-center rounded-md border border-[#d3ddd4] disabled:opacity-40"
                aria-label="Decrease quantity"
              >
                <Minus className="size-4" />
              </button>
              <span className="grid h-10 min-w-12 place-items-center rounded-md border border-[#d3ddd4] font-extrabold">{quantity}</span>
              <button
                type="button"
                onClick={() => setQuantity((current) => Math.min(limit, current + 1))}
                disabled={unavailable || quantity >= limit}
                className="grid size-10 place-items-center rounded-md border border-[#d3ddd4] disabled:opacity-40"
                aria-label="Increase quantity"
              >
                <Plus className="size-4" />
              </button>
            </div>
          </div>
        </div>

        <footer className="flex flex-col gap-3 border-t border-[#e5ebe6] bg-[#f8faf8] p-5 sm:flex-row sm:items-center sm:justify-between sm:px-7">
          <div>
            <p className="text-xs font-bold uppercase text-[#6d7771]">Subtotal</p>
            <p className="text-2xl font-extrabold text-primary">{formatPrice(total)}</p>
          </div>
          <Button
            className="h-12 px-6 text-base"
            disabled={unavailable}
            onClick={() => {
              if (!unavailable) onConfirm(product, selectedOptions, quantity);
            }}
          >
            <AssetIcon src="/assets/cart.svg" className="size-6" />
            {unavailable ? "Out of Stock" : "Add to Cart"}
          </Button>
        </footer>
      </section>
    </div>,
    document.body
  );
}
