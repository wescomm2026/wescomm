"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { getPickupAvailabilityFromApi, type BackendPickupPolicy } from "@/lib/api";
import { cn } from "@/lib/utils";

export type PickupSelection = {
  pickupDate: string;
  pickupSlotId: string;
  pickupPolicyVersion: number;
};

export type PickupSelectionSummary = {
  dateLabel: string;
  slotLabel: string;
};

function selectionSummary(policy: BackendPickupPolicy, selection: PickupSelection | null): PickupSelectionSummary | null {
  if (!selection) return null;
  const slot = policy.timeSlots.find((item) => item.id === selection.pickupSlotId && item.isActive);
  if (!slot) return null;
  return {
    dateLabel: new Date(`${selection.pickupDate}T00:00:00+08:00`).toLocaleDateString("en-PH", {
      weekday: "short",
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "Asia/Manila"
    }),
    slotLabel: slot.label
  };
}

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function monthStart(key: string) {
  return `${key.slice(0, 7)}-01`;
}

function changeMonth(key: string, amount: number) {
  const value = new Date(`${monthStart(key)}T00:00:00Z`);
  value.setUTCMonth(value.getUTCMonth() + amount);
  return dateKey(value);
}

function monthCells(month: string) {
  const first = new Date(`${monthStart(month)}T00:00:00Z`);
  const startOffset = first.getUTCDay();
  return Array.from({ length: 42 }, (_, index) => {
    const value = new Date(first);
    value.setUTCDate(1 - startOffset + index);
    return { key: dateKey(value), day: value.getUTCDate(), inMonth: value.getUTCMonth() === first.getUTCMonth() };
  });
}

function dateAvailability(policy: BackendPickupPolicy, key: string) {
  if (key < policy.minDate || key > policy.maxDate) return { available: false, reason: "Outside the allowed pickup range" };
  const closure = policy.closures.find((item) => item.date === key);
  if (closure) return { available: false, reason: closure.reason };
  const weekday = new Date(`${key}T00:00:00Z`).getUTCDay();
  const enabled = policy.days.find((day) => day.weekday === weekday)?.enabled === true;
  return enabled ? { available: true, reason: "" } : { available: false, reason: "No pickup on this day" };
}

function firstAvailableDate(policy: BackendPickupPolicy) {
  const current = new Date(`${policy.minDate}T00:00:00Z`);
  const last = new Date(`${policy.maxDate}T00:00:00Z`);
  while (current <= last) {
    const key = dateKey(current);
    if (dateAvailability(policy, key).available) return key;
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return "";
}

export function PickupSchedulePicker({
  selection,
  onChange,
  disabled = false,
  initialDate,
  title = "Choose a pickup date",
  autoSelectFirst = true,
  refreshKey = 0,
  policyOverride,
  onSelectionSummary
}: {
  selection: PickupSelection | null;
  onChange: (selection: PickupSelection | null) => void;
  disabled?: boolean;
  initialDate?: string | null;
  title?: string;
  autoSelectFirst?: boolean;
  refreshKey?: string | number;
  policyOverride?: BackendPickupPolicy | null;
  onSelectionSummary?: (summary: PickupSelectionSummary | null) => void;
}) {
  const [policy, setPolicy] = useState<BackendPickupPolicy | null>(null);
  const [visibleMonth, setVisibleMonth] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    const policyRequest = policyOverride
      ? Promise.resolve(policyOverride)
      : getPickupAvailabilityFromApi();

    policyRequest
      .then((nextPolicy) => {
        if (!active) return;
        setPolicy(nextPolicy);
        const preferredDate = initialDate && dateAvailability(nextPolicy, initialDate).available
          ? initialDate
          : firstAvailableDate(nextPolicy);
        const selectionMatchesPolicy = selection?.pickupPolicyVersion === nextPolicy.version;
        const selectedDate = selectionMatchesPolicy && selection?.pickupDate && dateAvailability(nextPolicy, selection.pickupDate).available
          ? selection.pickupDate
          : autoSelectFirst
            ? preferredDate
            : "";
        const activeSlots = nextPolicy.timeSlots.filter((slot) => slot.isActive);
        const selectedSlot = selectionMatchesPolicy && activeSlots.some((slot) => slot.id === selection?.pickupSlotId)
          ? selection!.pickupSlotId
          : autoSelectFirst
            ? activeSlots[0]?.id ?? ""
            : "";
        setVisibleMonth(monthStart(selectedDate || preferredDate || nextPolicy.minDate));
        const nextSelection = selectedDate && selectedSlot ? {
          pickupDate: selectedDate,
          pickupSlotId: selectedSlot,
          pickupPolicyVersion: nextPolicy.version
        } : null;
        if (
          nextSelection?.pickupDate !== selection?.pickupDate
          || nextSelection?.pickupSlotId !== selection?.pickupSlotId
          || nextSelection?.pickupPolicyVersion !== selection?.pickupPolicyVersion
        ) {
          onChange(nextSelection);
        }
        onSelectionSummary?.(selectionSummary(nextPolicy, nextSelection));
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Unable to load pickup availability.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  // The parent setter is stable; re-fetching on selection changes would reset keyboard/calendar navigation.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSelectFirst, initialDate, onChange, onSelectionSummary, policyOverride, refreshKey]);

  const cells = useMemo(() => visibleMonth ? monthCells(visibleMonth) : [], [visibleMonth]);
  const closureByDate = useMemo(() => new Map(policy?.closures.map((item) => [item.date, item.reason]) ?? []), [policy]);
  const activeSlots = policy?.timeSlots.filter((slot) => slot.isActive) ?? [];
  const previousDisabled = !policy || changeMonth(visibleMonth, -1).slice(0, 7) < policy.minDate.slice(0, 7);
  const nextDisabled = !policy || changeMonth(visibleMonth, 1).slice(0, 7) > policy.maxDate.slice(0, 7);

  if (loading) return <div className="rounded-lg border border-[#dce5dd] bg-[#f7faf7] p-4 text-sm font-semibold text-[#68746d]">Loading pickup calendar...</div>;
  if (error || !policy) return <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700" role="alert">{error || "Pickup scheduling is unavailable."}</div>;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(190px,0.62fr)]">
      <section className="rounded-lg border border-[#d7e2d8] bg-white p-3" aria-label="Pickup calendar">
        <div className="flex items-center gap-2 px-1 pb-3">
          <CalendarDays className="size-5 text-primary" />
          <div>
            <p className="text-sm font-extrabold text-[#17211b]">{title}</p>
            <p className="text-xs text-muted-foreground">Available {policy.minDate} to {policy.maxDate}</p>
          </div>
          <div className="ml-auto flex gap-1">
            <button type="button" onClick={() => setVisibleMonth(changeMonth(visibleMonth, -1))} disabled={disabled || previousDisabled} aria-label="Previous month" className="grid size-9 place-items-center rounded-md border border-[#d7e0d8] disabled:opacity-35"><ChevronLeft className="size-4" /></button>
            <button type="button" onClick={() => setVisibleMonth(changeMonth(visibleMonth, 1))} disabled={disabled || nextDisabled} aria-label="Next month" className="grid size-9 place-items-center rounded-md border border-[#d7e0d8] disabled:opacity-35"><ChevronRight className="size-4" /></button>
          </div>
        </div>
        <p className="mb-2 text-center text-sm font-extrabold text-[#253129]">
          {new Date(`${visibleMonth}T00:00:00Z`).toLocaleDateString("en-PH", { month: "long", year: "numeric", timeZone: "UTC" })}
        </p>
        <div className="grid grid-cols-7 text-center text-[11px] font-bold uppercase text-[#758078]">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <span key={day} className="py-1">{day}</span>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((cell) => {
            const availability = dateAvailability(policy, cell.key);
            const selected = selection?.pickupDate === cell.key;
            const closure = closureByDate.get(cell.key);
            return (
              <button
                key={cell.key}
                type="button"
                disabled={disabled || !cell.inMonth || !availability.available}
                title={availability.reason}
                aria-label={`${cell.key}${availability.available ? ", available" : `, unavailable: ${availability.reason}`}`}
                aria-pressed={selected}
                onClick={() => {
                  const nextSelection = {
                    pickupDate: cell.key,
                    pickupSlotId: activeSlots.some((slot) => slot.id === selection?.pickupSlotId)
                    ? selection!.pickupSlotId
                    : activeSlots[0]?.id || "",
                    pickupPolicyVersion: policy.version
                  };
                  onChange(nextSelection);
                  onSelectionSummary?.(selectionSummary(policy, nextSelection));
                }}
                className={cn(
                  "relative aspect-square min-h-9 rounded-md text-sm font-bold transition",
                  !cell.inMonth && "invisible",
                  availability.available && !selected && "border border-[#dce5dd] bg-[#f8fbf8] text-[#26332b] hover:border-primary hover:bg-[#edf7ed]",
                  selected && "bg-primary text-white shadow-sm",
                  !availability.available && cell.inMonth && "cursor-not-allowed bg-[#f2f3f2] text-[#a1a8a3] line-through",
                  closure && "ring-1 ring-inset ring-[#e4b8b8]"
                )}
              >
                {cell.day}
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[#68746d]">
          <span><i className="mr-1 inline-block size-2 rounded-full bg-primary" />Selected</span>
          <span><i className="mr-1 inline-block size-2 rounded-full bg-[#d7ddd8]" />Unavailable/weekend</span>
          <span><i className="mr-1 inline-block size-2 rounded-full bg-[#d98d8d]" />Closure</span>
        </div>
      </section>

      <section className="rounded-lg border border-[#d7e2d8] bg-[#f7faf7] p-4">
        <p className="text-sm font-extrabold text-[#17211b]">Available time slots</p>
        <p className="mt-1 text-xs leading-5 text-[#68746d]">Only currently active commissary windows are shown.</p>
        <div className="mt-3 grid gap-2">
          {activeSlots.map((slot) => (
            <button
              key={slot.id}
              type="button"
              disabled={disabled || !selection?.pickupDate}
              aria-pressed={selection?.pickupSlotId === slot.id}
              onClick={() => {
                const nextSelection = {
                  pickupDate: selection?.pickupDate ?? firstAvailableDate(policy),
                  pickupSlotId: slot.id,
                  pickupPolicyVersion: policy.version
                };
                onChange(nextSelection);
                onSelectionSummary?.(selectionSummary(policy, nextSelection));
              }}
              className={cn(
                "min-h-11 rounded-md border px-3 text-left text-sm font-bold transition disabled:opacity-50",
                selection?.pickupSlotId === slot.id
                  ? "border-primary bg-[#e8f4e8] text-primary ring-1 ring-primary"
                  : "border-[#d7e0d8] bg-white text-[#253129] hover:border-primary"
              )}
            >
              {slot.label}
            </button>
          ))}
        </div>
        {selection?.pickupDate ? (
          <p className="mt-4 rounded-md bg-white px-3 py-2 text-xs font-semibold text-[#536058]">
            Selected: {new Date(`${selection.pickupDate}T00:00:00+08:00`).toLocaleDateString("en-PH", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "Asia/Manila" })}
          </p>
        ) : null}
      </section>
    </div>
  );
}
