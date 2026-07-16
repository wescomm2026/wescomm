"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type ActionLoadingOverlayProps = {
  active: boolean;
  title: string;
  detail: string;
  className?: string;
};

const LOADING_OVERLAY_DELAY_MS = 300;

export function ActionLoadingOverlay({
  active,
  title,
  detail,
  className
}: ActionLoadingOverlayProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!active) {
      setVisible(false);
      return;
    }

    const timer = window.setTimeout(() => setVisible(true), LOADING_OVERLAY_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [active]);

  if (!active || !visible) return null;

  return (
    <div
      className={cn(
        "absolute inset-0 z-30 grid place-items-center bg-white/75 p-3 backdrop-blur-[2px]",
        className
      )}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-busy="true"
    >
      <div className="flex w-full max-w-md items-center gap-3 rounded-lg border border-[#cfe0d1] bg-white px-4 py-3.5 text-left shadow-[0_18px_50px_rgba(0,65,31,0.16)]">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#e8f4e9] text-primary">
          <Loader2 className="size-5 motion-safe:animate-spin" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="font-extrabold leading-5 text-[#17211b]">{title}</p>
          <p className="mt-1 text-sm leading-5 text-[#617069]">{detail}</p>
        </div>
      </div>
    </div>
  );
}
