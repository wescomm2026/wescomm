"use client";

import { useEffect, useState } from "react";
import { AssetIcon } from "@/components/ui/AssetIcon";
import {
  getPaymentOptionsFromApi,
  type BackendPaymentMethod,
  type BackendPaymentOptions
} from "@/lib/api";

export type StudentCheckoutPaymentMethod = Extract<
  BackendPaymentMethod,
  "PAY_AT_COMMISSARY" | "E_WALLET_AT_PICKUP" | "PAYMONGO_GCASH"
>;

const pickupMethods: Array<{
  value: StudentCheckoutPaymentMethod;
  label: string;
  detail: string;
  image: string;
}> = [
  {
    value: "PAY_AT_COMMISSARY",
    label: "Pay at Commissary",
    detail: "Cash payment during pickup",
    image: "/assets/cash.svg"
  },
  {
    value: "E_WALLET_AT_PICKUP",
    label: "E-wallet at Pickup",
    detail: "Scan the official QR at the counter",
    image: "/assets/e-wallet.svg"
  }
];

export function PaymentMethodSelector({
  value,
  onChange,
  name,
  disabled = false,
  legend = "Payment method"
}: {
  value: StudentCheckoutPaymentMethod | null;
  onChange: (value: StudentCheckoutPaymentMethod) => void;
  name: string;
  disabled?: boolean;
  legend?: string;
}) {
  const [options, setOptions] = useState<BackendPaymentOptions | null>(null);
  const [optionsError, setOptionsError] = useState("");

  useEffect(() => {
    let cancelled = false;

    getPaymentOptionsFromApi()
      .then((result) => {
        if (cancelled) return;
        setOptions(result);
        setOptionsError("");
      })
      .catch(() => {
        if (cancelled) return;
        setOptions(null);
        setOptionsError("Online GCash is unavailable right now. Pickup payment is still available.");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (options && !options.paymongoGcash.enabled && value === "PAYMONGO_GCASH") {
      onChange("PAY_AT_COMMISSARY");
    }
  }, [onChange, options, value]);

  const methods = options?.paymongoGcash.enabled
    ? [
        ...pickupMethods,
        {
          value: "PAYMONGO_GCASH" as const,
          label: "Pay Online via GCash",
          detail: "Continue to PayMongo and GCash, then return to WESCOMM",
          image: "/assets/e-wallet.svg"
        }
      ]
    : pickupMethods;

  return (
    <fieldset>
      <legend className="flex items-center gap-2 font-extrabold text-[#17211b]">
        <AssetIcon src="/assets/payment.svg" className="size-7" />
        {legend}
      </legend>
      <div className="mt-3 grid gap-2">
        {methods.map((method) => (
          <label
            key={method.value}
            className={`flex min-h-14 cursor-pointer items-start gap-3 rounded-md border p-3 transition focus-within:ring-2 focus-within:ring-primary/25 ${
              value === method.value ? "border-primary bg-[#edf6ed]" : "border-[#d7e0d8] bg-white"
            }`}
          >
            <input
              type="radio"
              name={name}
              value={method.value}
              checked={value === method.value}
              onChange={() => onChange(method.value)}
              disabled={disabled}
              className="mt-1 accent-primary"
            />
            <AssetIcon src={method.image} className="mt-0.5 size-7 shrink-0" />
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-2 text-sm font-bold text-[#253029]">
                {method.label}
                {method.value === "PAYMONGO_GCASH" && options && !options.paymongoGcash.livemode ? (
                  <span className="rounded-full bg-[#fff4c8] px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-[#735400]">
                    Test mode
                  </span>
                ) : null}
              </span>
              <span className="mt-0.5 block text-xs leading-5 text-[#6d7771]">{method.detail}</span>
              {method.value === "PAYMONGO_GCASH" && options && !options.paymongoGcash.livemode ? (
                <span className="mt-1 block text-xs font-semibold text-[#735400]">No real money will be charged.</span>
              ) : null}
            </span>
          </label>
        ))}
      </div>
      <p className="mt-2 min-h-5 text-xs leading-5 text-[#6d7771]" role="status" aria-live="polite">
        {optionsError || (!options ? "Checking online payment availability..." : "")}
      </p>
    </fieldset>
  );
}
