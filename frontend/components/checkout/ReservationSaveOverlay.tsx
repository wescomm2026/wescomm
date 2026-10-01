"use client";

import { useEffect, useRef } from "react";
import { AssetIcon } from "@/components/ui/AssetIcon";
import { Button } from "@/components/ui/button";

type SavedReservation = {
  id: string;
  referenceCode: string;
};

export function ReservationSaveOverlay({
  headingId,
  saving,
  reservation,
  onView,
  onDone
}: {
  headingId: string;
  saving: boolean;
  reservation: SavedReservation | null;
  onView: () => void;
  onDone: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const visible = saving || Boolean(reservation);

  useEffect(() => {
    if (!visible) return;
    const frame = window.requestAnimationFrame(() => headingRef.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [saving, visible]);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#101820]/65 px-4 py-6 backdrop-blur-[2px]" role="presentation">
      <div
        className={`my-auto w-full rounded-3xl bg-white px-6 py-8 text-center shadow-overlay sm:py-10 ${saving ? "max-w-[300px]" : "max-w-[430px] sm:px-8"}`}
        role={saving ? "status" : "group"}
        aria-live={saving ? "polite" : undefined}
        aria-busy={saving || undefined}
      >
        {saving ? (
          <>
            <AssetIcon src="/assets/wescomm_saving_reservation.svg" className="mx-auto size-44 motion-reduce:hidden sm:size-52" sizes="208px" />
            <AssetIcon src="/assets/wescomm_saving_reservation_static.svg" className="mx-auto hidden size-44 motion-reduce:inline-block sm:size-52" sizes="208px" />
          </>
        ) : (
          <AssetIcon src="/assets/wescomm_reservation_completed.svg" className="mx-auto size-44 sm:size-52" sizes="208px" />
        )}
        <h2 ref={headingRef} id={headingId} tabIndex={-1} className="mt-1 text-[1.7rem] font-extrabold leading-tight text-[#103d29] outline-none sm:text-3xl">
          {saving ? "Saving Reservation" : "Reservation Saved"}
        </h2>
        <p className="mx-auto mt-4 max-w-[330px] text-base leading-6 text-[#4d5c59] sm:text-lg sm:leading-7">
          {saving ? "Please wait while we save your reservation details." : "Your reservation has been completed successfully."}
        </p>
        {saving ? (
          <div className="mt-7 rounded-full bg-[#e8f4eb] px-5 py-3 text-base font-bold text-[#698277]" aria-hidden="true">Saving...</div>
        ) : (
          <>
            <p className="mt-7 break-words rounded-full bg-[#e8f4eb] px-4 py-3 text-base font-extrabold text-[#175038]" data-testid="saved-reservation-reference">
              Ref No: {reservation?.referenceCode}
            </p>
            <div className="mt-6 grid gap-3">
              <Button type="button" onClick={onView} className="h-14 w-full rounded-2xl text-lg font-bold">View Reservation</Button>
              <Button type="button" variant="secondary" onClick={onDone} className="h-14 w-full rounded-2xl bg-[#f7faf8] text-lg font-bold">Done</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
