"use client";

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type ActionLoadingOverlayProps = {
  active: boolean;
  title: string;
  detail: string;
  steps?: readonly string[];
  mode?: "fixed" | "absolute";
  className?: string;
};

export function ActionLoadingOverlay({
  active,
  title,
  detail,
  steps = [],
  mode = "absolute",
  className
}: ActionLoadingOverlayProps) {
  if (!active) return null;

  return (
    <div
      className={cn(
        mode === "fixed" ? "fixed inset-0 z-[12000]" : "absolute inset-0 z-30",
        "grid place-items-center bg-white/82 p-4 backdrop-blur-[3px]",
        className
      )}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="w-full max-w-sm rounded-lg border border-[#cfe0d1] bg-white p-5 text-center shadow-[0_24px_70px_rgba(0,65,31,0.18)]">
        <span className="mx-auto grid size-14 place-items-center rounded-full bg-[#e8f4e9] text-primary">
          <Loader2 className="size-7 animate-spin" />
        </span>
        <h2 className="mt-4 text-lg font-extrabold text-[#17211b]">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-[#617069]">{detail}</p>
        {steps.length ? (
          <div className="mt-4 space-y-2 rounded-md bg-[#f5faf5] p-3 text-left">
            {steps.map((step) => (
              <div key={step} className="flex items-center gap-2 text-xs font-semibold text-[#536158]">
                <span className="size-1.5 rounded-full bg-primary" />
                {step}
              </div>
            ))}
          </div>
        ) : null}
        <p className="mt-4 text-xs font-semibold text-[#7a857f]">Please keep this page open.</p>
      </div>
    </div>
  );
}
