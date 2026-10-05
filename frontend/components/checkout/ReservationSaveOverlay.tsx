"use client";

import { Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AssetIcon } from "@/components/ui/AssetIcon";
import { Button } from "@/components/ui/button";
import type { ReservationSaveState } from "@/lib/reservation-save-state";

function ResultBadge({ tone }: { tone: "success" | "error" }) {
  const success = tone === "success";
  return (
    <span className="relative mx-auto grid size-28 place-items-center sm:size-32" aria-hidden="true">
      <span className={`result-badge-ring absolute inset-0 rounded-full ${success ? "bg-primary/25" : "bg-danger/20"}`} />
      <span className={`result-badge-circle relative grid size-24 place-items-center rounded-full shadow-overlay sm:size-28 ${success ? "bg-primary" : "bg-danger"}`}>
        <span className={`absolute inset-2 rounded-full border-2 ${success ? "border-primary-foreground/25" : "border-white/25"}`} />
        <svg viewBox="0 0 48 48" className="relative size-12 sm:size-14" fill="none">
          {success ? (
            <path className="result-badge-mark" d="M13 25.5 20.5 33 35 17" stroke="white" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
          ) : (
            <path className="result-badge-mark" d="M16 16 32 32M32 16 16 32" stroke="white" strokeWidth="5" strokeLinecap="round" />
          )}
        </svg>
      </span>
    </span>
  );
}

type SavedReservation = {
  id: string;
  referenceCode: string;
};

export function ReservationSaveOverlay({
  headingId,
  state,
  reservation,
  error,
  onView,
  onDone,
  onReview
}: {
  headingId: string;
  state: ReservationSaveState;
  reservation: SavedReservation | null;
  error: string;
  onView: () => void;
  onDone: () => void;
  onReview: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const visible = state !== "idle";
  const saving = state === "saving";
  const failed = state === "failed";

  useEffect(() => {
    if (!visible) return;
    const frame = window.requestAnimationFrame(() => headingRef.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [state, visible]);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-foreground/60 px-4 py-6 backdrop-blur-[2px]" role="presentation">
      <div
        className={`my-auto w-full rounded-3xl bg-white px-6 py-8 text-center shadow-overlay sm:py-10 ${saving ? "max-w-[300px]" : "max-w-[430px] sm:px-8"}`}
        role={saving ? "status" : failed ? "alert" : "group"}
        aria-live={saving ? "polite" : undefined}
        aria-busy={saving || undefined}
      >
        {saving ? (
          <>
            <AssetIcon src="/assets/wescomm_saving_reservation.svg" className="mx-auto size-44 motion-reduce:hidden sm:size-52" sizes="208px" />
            <AssetIcon src="/assets/wescomm_saving_reservation_static.svg" className="mx-auto hidden size-44 motion-reduce:inline-block sm:size-52" sizes="208px" />
          </>
        ) : (
          <ResultBadge tone={failed ? "error" : "success"} />
        )}
        <h2 ref={headingRef} id={headingId} tabIndex={-1} className={`text-[1.7rem] font-extrabold leading-tight text-foreground outline-none sm:text-3xl ${saving ? "mt-1" : "mt-5"}`}>
          {saving ? "Saving Reservation" : failed ? "Reservation not saved" : "Reservation Saved"}
        </h2>
        <p className="mx-auto mt-3 max-w-[340px] text-base leading-6 text-muted-foreground">
          {saving
            ? "Please wait while we save your reservation details."
            : failed
              ? error || "WESCOMM could not save the reservation. Review the details and try again."
              : "Your items are held while staff confirms your request. We'll notify you when they're ready. No need to visit the commissary yet."}
        </p>
        {saving ? (
          <div className="mt-7 rounded-full bg-primary/10 px-5 py-3 text-base font-bold text-primary" aria-hidden="true">Saving...</div>
        ) : failed ? (
          <Button type="button" onClick={onReview} className="mt-7 h-14 w-full rounded-2xl text-lg font-bold">
            Review and try again
          </Button>
        ) : (
          <>
            <div className="mt-6 flex items-center justify-between gap-3 rounded-2xl border border-primary/15 bg-primary/5 py-2.5 pl-4 pr-2 text-left">
              <p className="min-w-0" data-testid="saved-reservation-reference">
                <span className="block text-[11px] font-extrabold uppercase tracking-wide text-muted-foreground">Reference number</span>
                <span className="block break-all font-mono text-base font-extrabold text-primary">{reservation?.referenceCode}</span>
              </p>
              {reservation?.referenceCode ? <CopyReferenceButton value={reservation.referenceCode} /> : null}
            </div>
            <div className="mt-6 grid gap-3">
              <Button type="button" onClick={onView} className="h-14 w-full rounded-2xl text-lg font-bold">View Reservation</Button>
              <Button type="button" variant="secondary" onClick={onDone} className="h-14 w-full rounded-2xl text-lg font-bold">Done</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function CopyReferenceButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        }).catch(() => undefined);
      }}
      className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl px-3 text-sm font-bold text-primary transition hover:bg-primary/10"
      aria-label={copied ? "Reference number copied" : "Copy reference number"}
    >
      <Copy className="size-4" aria-hidden="true" />
      <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}
