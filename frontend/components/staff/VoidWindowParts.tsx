"use client";

import { Clock } from "lucide-react";
import { VOID_REASON_PRESETS, type VoidWindowState } from "@/lib/void-window";
import { cn } from "@/lib/utils";

/** One-line deadline shown on receipt cards. */
export function VoidWindowBadge({ state, className }: { state: VoidWindowState; className?: string }) {
  if (!state.label) return null;
  return (
    <p className={cn("flex items-center gap-1.5 text-xs font-semibold", state.open ? "text-muted-foreground" : "text-amber-800", className)}>
      <Clock className="size-3.5 shrink-0" aria-hidden="true" />
      {state.label}
      {!state.open && !state.adminOverride ? " · admin only" : ""}
    </p>
  );
}

/** Explains what a void does, the deadline, and offers common reasons. */
export function VoidDialogDetails({
  state,
  reason,
  onReasonChange
}: {
  state: VoidWindowState;
  reason: string;
  onReasonChange: (value: string) => void;
}) {
  return (
    <div className="mt-4 grid gap-3">
      <ul className="grid gap-1 rounded-md border bg-surface-subtle px-3 py-2 text-xs leading-5 text-muted-foreground">
        <li>The items go back to inventory.</li>
        <li>The sale is removed from sales reports and listed under Voided Transactions.</li>
        <li>Return the payment to the buyer outside WESCOMM.</li>
      </ul>
      {state.adminOverride ? (
        <p role="note" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold leading-5 text-amber-900">
          The 2-day void period has ended ({state.label.replace("Void period ended ", "")}). You are voiding as an admin; state why in the reason.
        </p>
      ) : state.label ? (
        <p className="text-xs font-semibold text-muted-foreground">{state.label} (2-day void period).</p>
      ) : null}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Common reasons">
        {VOID_REASON_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => onReasonChange(preset)}
            aria-pressed={reason === preset}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-bold transition",
              reason === preset ? "border-primary bg-primary/10 text-primary" : "border-border-strong bg-white text-foreground hover:bg-surface-subtle"
            )}
          >
            {preset}
          </button>
        ))}
      </div>
    </div>
  );
}
