"use client";

import { AssetIcon } from "@/components/ui/AssetIcon";

/**
 * Cash is the only payment method for new reservations. This component shows
 * the fixed method and is kept as a labelled block so checkout layouts stay
 * consistent with the "Where will you pay?" choice that follows.
 */
export function PaymentMethodSelector({
  legend = "Payment method"
}: {
  legend?: string;
}) {
  return (
    <fieldset>
      <legend className="flex items-center gap-3 text-lg font-extrabold text-[#17211b] sm:text-xl">
        <AssetIcon src="/assets/payment.svg" className="size-8" />
        {legend}
      </legend>
      <p className="mt-1 text-sm text-[#657169]">Cash is the only accepted payment method for new reservations.</p>
      <div className="mt-4">
        <div className="flex min-h-16 items-center gap-3 rounded-xl border border-[#d7e0d8] bg-[#f0faf3] px-4 py-3.5">
          <AssetIcon src="/assets/cash.svg" className="size-8 shrink-0" />
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2 text-sm font-extrabold text-[#253029] sm:text-base">
              Cash
            </span>
            <span className="mt-0.5 block text-xs leading-5 text-[#6d7771] sm:text-sm">
              Pay in cash when you claim your order.
            </span>
          </span>
        </div>
      </div>
    </fieldset>
  );
}
