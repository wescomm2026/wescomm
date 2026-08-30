"use client";

import { userFacingErrorMessage } from "@/lib/user-facing-error";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import {
  ArrowDown,
  ArrowUp,
  CalendarClock,
  CalendarDays,
  Check,
  Clock3,
  Eye,
  GripVertical,
  History,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  TriangleAlert,
  X
} from "lucide-react";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import { PickupSchedulePicker, type PickupSelection } from "@/components/pickup/PickupSchedulePicker";
import { Button } from "@/components/ui/button";
import { useConfirmationDialog } from "@/components/ui/ConfirmationDialogProvider";
import { FeedbackState } from "@/components/ui/FeedbackState";
import { FormControl, formControlClass } from "@/components/ui/FormControl";
import { PageHeader } from "@/components/ui/PageHeader";
import { Surface } from "@/components/ui/Surface";
import { useAccessibleDialog } from "@/components/ui/useAccessibleDialog";
import {
  createPickupPolicyFromApi,
  getCurrentPickupPolicyFromApi,
  previewPickupPolicyFromApi,
  type BackendPickupPolicy,
  type PickupPolicyPayload
} from "@/lib/api";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SHORT_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type PolicyPreview = Awaited<ReturnType<typeof previewPickupPolicyFromApi>>;
type SlotEditor = {
  index: number | null;
  label: string;
  startMinute: number;
  endMinute: number;
  isActive: boolean;
};
type ClosureEditor = { index: number | null; date: string; reason: string };

function timeValue(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function timeMinutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function formatTime(minutes: number) {
  const date = new Date(Date.UTC(2026, 0, 1, Math.floor(minutes / 60), minutes % 60));
  return date.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
}

function addDays(dateKey: string, amount: number) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function draftFromPolicy(policy: BackendPickupPolicy): PickupPolicyPayload {
  return {
    minAdvanceDays: policy.minAdvanceDays,
    maxAdvanceDays: policy.maxAdvanceDays,
    reason: "",
    days: policy.days.map((day) => ({ weekday: day.weekday, enabled: day.enabled })),
    timeSlots: policy.timeSlots.map((slot) => ({
      label: slot.label,
      startMinute: slot.startMinute,
      endMinute: slot.endMinute,
      isActive: slot.isActive
    })),
    closures: policy.closures.map((closure) => ({ date: closure.date, reason: closure.reason }))
  };
}

function comparableDraft(draft: PickupPolicyPayload | null) {
  if (!draft) return "";
  return JSON.stringify({ ...draft, reason: "" });
}

function validateDraft(draft: PickupPolicyPayload) {
  if (!Number.isInteger(draft.minAdvanceDays) || draft.minAdvanceDays < 0 || draft.minAdvanceDays > 365) {
    return "Earliest booking must be between 0 and 365 days ahead.";
  }
  if (!Number.isInteger(draft.maxAdvanceDays) || draft.maxAdvanceDays < 1 || draft.maxAdvanceDays > 3650) {
    return "Latest booking must be between 1 and 3650 days ahead.";
  }
  if (draft.maxAdvanceDays < draft.minAdvanceDays) {
    return "Latest booking cannot be earlier than the earliest booking.";
  }
  if (!draft.days.some((day) => day.enabled)) return "Open at least one pickup day.";
  if (!draft.timeSlots.length) return "Add at least one pickup time slot.";
  if (draft.timeSlots.some((slot) => slot.label.trim().length < 3 || slot.endMinute <= slot.startMinute)) {
    return "Every time slot needs a valid name, start time, and end time.";
  }
  const activeSlots = [...draft.timeSlots.filter((slot) => slot.isActive)].sort((left, right) => left.startMinute - right.startMinute);
  if (!activeSlots.length) return "Keep at least one pickup time slot active.";
  if (activeSlots.some((slot, index) => index > 0 && activeSlots[index - 1].endMinute > slot.startMinute)) {
    return "Active pickup time slots cannot overlap.";
  }
  return "";
}

function SettingsSection({ number, title, description, children }: {
  number: number;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Surface className="p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-sm font-extrabold text-primary-foreground" aria-hidden="true">{number}</span>
        <div>
          <h2 className="text-lg font-extrabold text-foreground">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="mt-5">{children}</div>
    </Surface>
  );
}

function SummaryCard({ icon, label, value, detail }: { icon: ReactNode; label: string; value: string; detail: string }) {
  return (
    <Surface className="p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-control bg-primary/10 text-primary" aria-hidden="true">{icon}</span>
        <div className="min-w-0">
          <p className="text-xs font-extrabold uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-1 font-extrabold text-foreground">{value}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p>
        </div>
      </div>
    </Surface>
  );
}

export function StaffPickupScheduleExperience() {
  const { user } = useStudentAuth();
  const confirm = useConfirmationDialog();
  const [policies, setPolicies] = useState<BackendPickupPolicy[]>([]);
  const [savedDraft, setSavedDraft] = useState<PickupPolicyPayload | null>(null);
  const [draft, setDraft] = useState<PickupPolicyPayload | null>(null);
  const [impactPreview, setImpactPreview] = useState<PolicyPreview | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [studentPreviewOpen, setStudentPreviewOpen] = useState(false);
  const [studentPreviewSelection, setStudentPreviewSelection] = useState<PickupSelection | null>(null);
  const [slotEditor, setSlotEditor] = useState<SlotEditor | null>(null);
  const [closureEditor, setClosureEditor] = useState<ClosureEditor | null>(null);
  const [changeNote, setChangeNote] = useState("");
  const [draggedSlotIndex, setDraggedSlotIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const active = policies.find((policy) => policy.isActive) ?? policies[0];
  const isDirty = comparableDraft(draft) !== comparableDraft(savedDraft);
  const draftError = draft ? validateDraft(draft) : "";

  const loadPolicies = useCallback(async () => {
    if (!user?.accessToken || (user.role !== "STAFF" && user.role !== "ADMIN")) return;
    setLoading(true);
    setError("");
    try {
      const activePolicy = await getCurrentPickupPolicyFromApi(user.accessToken);
      setPolicies([activePolicy]);
      if (activePolicy) {
        const nextDraft = draftFromPolicy(activePolicy);
        setSavedDraft(nextDraft);
        setDraft(nextDraft);
      }
    } catch (loadError) {
      setError(userFacingErrorMessage(loadError, "Unable to load the pickup schedule."));
    } finally {
      setLoading(false);
    }
  }, [user?.accessToken, user?.role]);

  useEffect(() => { void loadPolicies(); }, [loadPolicies]);

  useEffect(() => {
    if (!isDirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [isDirty]);

  const slotDialog = useAccessibleDialog<HTMLElement>(Boolean(slotEditor), () => setSlotEditor(null));
  const closureDialog = useAccessibleDialog<HTMLElement>(Boolean(closureEditor), () => setClosureEditor(null));
  const studentPreviewDialog = useAccessibleDialog<HTMLElement>(studentPreviewOpen, () => setStudentPreviewOpen(false));
  const reviewDialog = useAccessibleDialog<HTMLElement>(reviewOpen, () => {
    if (!submitting) setReviewOpen(false);
  });

  const updateDraft = (updater: (current: PickupPolicyPayload) => PickupPolicyPayload) => {
    setDraft((current) => current ? updater(current) : current);
    setImpactPreview(null);
    setReviewOpen(false);
    setNotice("");
    setError("");
  };

  const openDays = draft?.days.filter((day) => day.enabled).map((day) => SHORT_WEEKDAYS[day.weekday]) ?? [];
  const activeSlots = useMemo(
    () => [...(draft?.timeSlots.filter((slot) => slot.isActive) ?? [])].sort((left, right) => left.startMinute - right.startMinute),
    [draft?.timeSlots]
  );
  const slotSpan = activeSlots.length
    ? `${formatTime(activeSlots[0].startMinute)}–${formatTime(activeSlots[activeSlots.length - 1].endMinute)}`
    : "No active times";

  const previewPolicy = useMemo<BackendPickupPolicy | null>(() => {
    if (!active || !draft) return null;
    return {
      ...active,
      id: "draft-pickup-schedule",
      minAdvanceDays: draft.minAdvanceDays,
      maxAdvanceDays: draft.maxAdvanceDays,
      minDate: addDays(active.serverDate, draft.minAdvanceDays),
      maxDate: addDays(active.serverDate, draft.maxAdvanceDays),
      days: draft.days,
      timeSlots: draft.timeSlots.map((slot, index) => ({ ...slot, id: `draft-slot-${index}`, sortOrder: index })),
      closures: draft.closures.map((closure, index) => ({ ...closure, id: `draft-closure-${index}` }))
    };
  }, [active, draft]);

  const openSlotEditor = (index: number | null) => {
    if (!draft) return;
    const slot = index === null ? null : draft.timeSlots[index];
    const lastEnd = draft.timeSlots.at(-1)?.endMinute ?? 480;
    const startMinute = Math.min(lastEnd, 1380);
    setSlotEditor(slot ? { index, ...slot } : {
      index: null,
      label: "",
      startMinute,
      endMinute: Math.min(startMinute + 120, 1440),
      isActive: true
    });
  };

  const saveSlot = () => {
    if (!slotEditor) return;
    if (slotEditor.endMinute <= slotEditor.startMinute) {
      setError("The slot end time must be later than its start time.");
      return;
    }
    const slot = {
      label: slotEditor.label.trim() || `${formatTime(slotEditor.startMinute)} – ${formatTime(slotEditor.endMinute)}`,
      startMinute: slotEditor.startMinute,
      endMinute: slotEditor.endMinute,
      isActive: slotEditor.isActive
    };
    updateDraft((current) => ({
      ...current,
      timeSlots: slotEditor.index === null
        ? [...current.timeSlots, slot]
        : current.timeSlots.map((item, index) => index === slotEditor.index ? slot : item)
    }));
    setSlotEditor(null);
  };

  const moveSlot = (from: number, to: number) => {
    if (!draft || from === to || to < 0 || to >= draft.timeSlots.length) return;
    updateDraft((current) => {
      const timeSlots = [...current.timeSlots];
      const [slot] = timeSlots.splice(from, 1);
      timeSlots.splice(to, 0, slot);
      return { ...current, timeSlots };
    });
  };

  const saveClosure = () => {
    if (!closureEditor?.date || closureEditor.reason.trim().length < 2) {
      setError("Choose a closed date and enter a short reason.");
      return;
    }
    const duplicateIndex = draft?.closures.findIndex((closure) => closure.date === closureEditor.date) ?? -1;
    if (duplicateIndex >= 0 && duplicateIndex !== closureEditor.index) {
      setError("That date is already listed as closed.");
      return;
    }
    const closure = { date: closureEditor.date, reason: closureEditor.reason.trim() };
    updateDraft((current) => ({
      ...current,
      closures: (closureEditor.index === null
        ? [...current.closures, closure]
        : current.closures.map((item, index) => index === closureEditor.index ? closure : item))
        .sort((left, right) => left.date.localeCompare(right.date))
    }));
    setClosureEditor(null);
  };

  const discardChanges = async () => {
    if (!savedDraft || !isDirty) return;
    const approved = await confirm({
      title: "Discard pickup schedule changes?",
      description: "Your unsaved booking window, pickup day, time slot, and closure changes will be removed.",
      confirmLabel: "Discard Changes",
      tone: "warning"
    });
    if (!approved) return;
    setDraft(savedDraft);
    setImpactPreview(null);
    setChangeNote("");
    setError("");
  };

  const refreshSchedule = async () => {
    if (isDirty) {
      const approved = await confirm({
        title: "Reload the saved schedule?",
        description: "Reloading will discard your unsaved changes and fetch the latest schedule.",
        confirmLabel: "Reload Schedule",
        tone: "warning"
      });
      if (!approved) return;
    }
    await loadPolicies();
  };

  const requestSaveReview = async () => {
    if (!user?.accessToken || !draft) return;
    const validationMessage = validateDraft(draft);
    if (validationMessage) {
      setError(validationMessage);
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const preview = await previewPickupPolicyFromApi(user.accessToken, {
        ...draft,
        reason: "Pending pickup schedule review"
      });
      setImpactPreview(preview);
      setChangeNote("");
      setReviewOpen(true);
    } catch (previewError) {
      setError(userFacingErrorMessage(previewError, "Unable to review these schedule changes."));
    } finally {
      setSubmitting(false);
    }
  };

  const saveChanges = async () => {
    if (!user?.accessToken || !draft || !impactPreview || changeNote.trim().length < 5) return;
    setSubmitting(true);
    setError("");
    try {
      const result = await createPickupPolicyFromApi(user.accessToken, { ...draft, reason: changeNote.trim() });
      setReviewOpen(false);
      setImpactPreview(null);
      setNotice(`Pickup schedule updated. ${result.affectedCount} existing reservation(s) need review; saved pickup times were not changed automatically.`);
      await loadPolicies();
    } catch (saveError) {
      setError(userFacingErrorMessage(saveError, "Unable to save the pickup schedule."));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || !draft || !active) {
    return <FeedbackState kind="loading" title="Loading pickup schedule" description="Getting the latest available days, times, and closures." />;
  }

  return (
    <div className="space-y-5 pb-24">
      <PageHeader
        eyebrow="Commissary operations"
        title="Pickup schedule"
        description="Set when students can collect their reservations. Schedule changes apply to new reservations; existing pickup times never change silently."
        meta={isDirty ? <span className="inline-flex rounded-full bg-warning/10 px-2.5 py-1 text-warning">Unsaved changes</span> : <span>All changes saved</span>}
        action={(
          <div className="flex items-center gap-2">
            {user?.role === "ADMIN" ? (
              <Link href="/admin/audit-logs?entityType=pickup_policy">
                <Button variant="secondary"><History className="size-4" />View change history</Button>
              </Link>
            ) : null}
            <Button variant="ghost" size="icon" onClick={() => void refreshSchedule()} disabled={submitting} aria-label="Refresh pickup schedule" title="Refresh pickup schedule">
              <RefreshCw className="size-4" />
            </Button>
          </div>
        )}
      />

      {notice ? <p className="rounded-surface border border-success/25 bg-success/5 px-4 py-3 text-sm font-semibold text-success" role="status">{notice}</p> : null}
      {error ? <p className="rounded-surface border border-danger/25 bg-danger/5 px-4 py-3 text-sm font-semibold text-danger" role="alert">{error}</p> : null}

      <section className="grid gap-3 md:grid-cols-3" aria-label="Pickup schedule summary">
        <SummaryCard icon={<CalendarClock className="size-5" />} label="Booking window" value={`${draft.minAdvanceDays}–${draft.maxAdvanceDays} days ahead`} detail={`Students can choose dates from ${addDays(active.serverDate, draft.minAdvanceDays)} to ${addDays(active.serverDate, draft.maxAdvanceDays)}.`} />
        <SummaryCard icon={<CalendarDays className="size-5" />} label="Open pickup days" value={openDays.join(", ") || "No open days"} detail={`${openDays.length} day${openDays.length === 1 ? "" : "s"} available each week.`} />
        <SummaryCard icon={<Clock3 className="size-5" />} label="Active time slots" value={`${activeSlots.length} slot${activeSlots.length === 1 ? "" : "s"}`} detail={slotSpan} />
      </section>

      <SettingsSection number={1} title="Booking window" description="Choose how early and how far ahead students can reserve a pickup date.">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormControl label="Earliest booking" htmlFor="pickup-min-days" helper={`Students can book starting ${draft.minAdvanceDays} day${draft.minAdvanceDays === 1 ? "" : "s"} from today.`}>
            <div className="relative">
              <input id="pickup-min-days" type="number" min={0} max={365} value={draft.minAdvanceDays} onChange={(event) => updateDraft((current) => ({ ...current, minAdvanceDays: Number(event.target.value) }))} className={cn(formControlClass, "pr-24")} />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-semibold text-muted-foreground">days ahead</span>
            </div>
          </FormControl>
          <FormControl label="Latest booking" htmlFor="pickup-max-days" error={draft.maxAdvanceDays < draft.minAdvanceDays ? "Must be the same as or later than the earliest booking." : undefined} helper={`Students can book up to ${draft.maxAdvanceDays} day${draft.maxAdvanceDays === 1 ? "" : "s"} from today.`}>
            <div className="relative">
              <input id="pickup-max-days" type="number" min={1} max={3650} value={draft.maxAdvanceDays} onChange={(event) => updateDraft((current) => ({ ...current, maxAdvanceDays: Number(event.target.value) }))} className={cn(formControlClass, "pr-24")} />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-semibold text-muted-foreground">days ahead</span>
            </div>
          </FormControl>
        </div>
      </SettingsSection>

      <SettingsSection number={2} title="Open pickup days" description="Select the weekdays when students may collect reservations.">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {WEEKDAYS.map((label, weekday) => {
            const enabled = draft.days.find((day) => day.weekday === weekday)?.enabled === true;
            return (
              <button key={label} type="button" aria-pressed={enabled} aria-label={`${label}: ${enabled ? "open" : "closed"}`} onClick={() => updateDraft((current) => ({ ...current, days: current.days.map((day) => day.weekday === weekday ? { ...day, enabled: !day.enabled } : day) }))} className={cn("min-h-16 rounded-control border px-2 text-sm font-bold transition", enabled ? "border-primary bg-primary/10 text-primary ring-1 ring-primary" : "border-border bg-muted/40 text-muted-foreground")}>
                <span className="flex items-center justify-center gap-1.5">{enabled ? <Check className="size-4" /> : <X className="size-4" />}{label.slice(0, 3)}</span>
                <span className="mt-1 block text-[11px] font-semibold">{enabled ? "Open" : "Closed"}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-sm text-muted-foreground">Pickups are currently available on {openDays.length ? openDays.join(", ") : "no weekdays"}.</p>
      </SettingsSection>

      <SettingsSection number={3} title="Pickup time slots" description="Keep the list simple for students and turn off a slot without deleting it.">
        <div className="flex justify-end"><Button variant="secondary" onClick={() => openSlotEditor(null)}><Plus className="size-4" />Add time slot</Button></div>
        <div className="mt-4 grid gap-2">
          {draft.timeSlots.map((slot, index) => (
            <article key={`${slot.startMinute}-${slot.endMinute}-${index}`} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (draggedSlotIndex !== null) moveSlot(draggedSlotIndex, index); setDraggedSlotIndex(null); }} className="flex flex-wrap items-center gap-3 rounded-surface border bg-white p-3">
              <span draggable aria-hidden="true" onDragStart={() => setDraggedSlotIndex(index)} onDragEnd={() => setDraggedSlotIndex(null)} className="cursor-grab text-muted-foreground active:cursor-grabbing"><GripVertical className="size-5" /></span>
              <div className="min-w-[180px] flex-1"><p className="font-extrabold text-foreground">{formatTime(slot.startMinute)} – {formatTime(slot.endMinute)}</p><p className="mt-0.5 text-xs text-muted-foreground">{slot.label}</p></div>
              <button type="button" role="switch" aria-checked={slot.isActive} aria-label={`${slot.label}: ${slot.isActive ? "active" : "inactive"}`} onClick={() => updateDraft((current) => ({ ...current, timeSlots: current.timeSlots.map((item, itemIndex) => itemIndex === index ? { ...item, isActive: !item.isActive } : item) }))} className={cn("inline-flex h-8 items-center gap-2 rounded-full px-3 text-xs font-bold", slot.isActive ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                <span className={cn("size-2 rounded-full", slot.isActive ? "bg-primary" : "bg-muted-foreground")} />{slot.isActive ? "Active" : "Inactive"}
              </button>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" onClick={() => moveSlot(index, index - 1)} disabled={index === 0} aria-label={`Move ${slot.label} up`}><ArrowUp className="size-4" /></Button>
                <Button variant="ghost" size="icon" onClick={() => moveSlot(index, index + 1)} disabled={index === draft.timeSlots.length - 1} aria-label={`Move ${slot.label} down`}><ArrowDown className="size-4" /></Button>
                <Button variant="ghost" size="icon" onClick={() => openSlotEditor(index)} aria-label={`Edit ${slot.label}`}><Pencil className="size-4" /></Button>
                <Button variant="ghost" size="icon" className="text-danger hover:bg-danger/5" onClick={() => updateDraft((current) => ({ ...current, timeSlots: current.timeSlots.filter((_, itemIndex) => itemIndex !== index) }))} aria-label={`Delete ${slot.label}`}><Trash2 className="size-4" /></Button>
              </div>
            </article>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection number={4} title="Closed dates and holidays" description="Block a specific date without changing the regular weekly schedule.">
        <div className="flex justify-end"><Button variant="secondary" onClick={() => setClosureEditor({ index: null, date: "", reason: "" })}><Plus className="size-4" />Add closed date</Button></div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {draft.closures.length ? draft.closures.map((closure, index) => (
            <article key={closure.date} className="flex items-center gap-3 rounded-surface border bg-white px-4 py-3">
              <CalendarDays className="size-5 shrink-0 text-primary" />
              <div className="min-w-0"><p className="font-extrabold text-foreground">{new Date(`${closure.date}T00:00:00+08:00`).toLocaleDateString("en-PH", { weekday: "short", month: "long", day: "numeric", year: "numeric", timeZone: "Asia/Manila" })}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">{closure.reason}</p></div>
              <Button variant="ghost" size="icon" className="ml-auto" onClick={() => setClosureEditor({ index, ...closure })} aria-label={`Edit closure ${closure.date}`}><Pencil className="size-4" /></Button>
              <Button variant="ghost" size="icon" className="text-danger hover:bg-danger/5" onClick={() => updateDraft((current) => ({ ...current, closures: current.closures.filter((_, itemIndex) => itemIndex !== index) }))} aria-label={`Remove closure ${closure.date}`}><Trash2 className="size-4" /></Button>
            </article>
          )) : (
            <div className="rounded-surface border border-dashed bg-surface-subtle p-5 text-center sm:col-span-2"><CalendarDays className="mx-auto size-7 text-muted-foreground" /><p className="mt-2 font-bold text-foreground">No closed dates added</p><p className="mt-1 text-sm text-muted-foreground">Weekends and other closed weekdays are already handled above.</p></div>
          )}
        </div>
      </SettingsSection>

      {draftError ? <p className="rounded-surface border border-warning/25 bg-warning/5 px-4 py-3 text-sm font-semibold text-warning" role="status">Before saving: {draftError}</p> : null}

      <div className="sticky bottom-3 z-30 flex flex-col gap-3 rounded-feature border bg-white/95 p-3 shadow-overlay backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-semibold text-muted-foreground">{isDirty ? "You have unsaved schedule changes." : "The pickup schedule is up to date."}</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="ghost" onClick={() => void discardChanges()} disabled={!isDirty || submitting}>Discard Changes</Button>
          <Button variant="secondary" onClick={() => { setStudentPreviewSelection(null); setStudentPreviewOpen(true); }} disabled={Boolean(draftError)}><Eye className="size-4" />Preview Student View</Button>
          <Button onClick={() => void requestSaveReview()} disabled={!isDirty || Boolean(draftError)} loading={submitting}><Save className="size-4" />Save Changes</Button>
        </div>
      </div>

      {slotEditor ? (
        <div className="fixed inset-0 z-[12000] grid place-items-center overflow-y-auto bg-foreground/55 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) setSlotEditor(null); }}>
          <section ref={slotDialog.dialogRef} {...slotDialog.dialogProps} className="w-full max-w-lg rounded-feature border bg-white shadow-overlay outline-none">
            <div className="flex items-start justify-between gap-4 border-b p-5"><div><h2 id={slotDialog.titleId} className="text-xl font-extrabold text-foreground">{slotEditor.index === null ? "Add pickup time slot" : "Edit pickup time slot"}</h2><p className="mt-1 text-sm text-muted-foreground">Set a clear collection window for students.</p></div><Button variant="ghost" size="icon" onClick={() => setSlotEditor(null)} aria-label="Close time slot editor"><X className="size-5" /></Button></div>
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <FormControl label="Start time" htmlFor="slot-start" required><input id="slot-start" type="time" value={timeValue(slotEditor.startMinute)} onChange={(event) => setSlotEditor((current) => current ? { ...current, startMinute: timeMinutes(event.target.value) } : current)} className={formControlClass} data-dialog-autofocus /></FormControl>
              <FormControl label="End time" htmlFor="slot-end" required error={slotEditor.endMinute <= slotEditor.startMinute ? "End time must be later than start time." : undefined}><input id="slot-end" type="time" value={timeValue(slotEditor.endMinute)} onChange={(event) => setSlotEditor((current) => current ? { ...current, endMinute: timeMinutes(event.target.value) } : current)} className={formControlClass} /></FormControl>
              <FormControl label="Display name (optional)" htmlFor="slot-label" helper="If blank, the time range becomes the name." className="sm:col-span-2"><input id="slot-label" value={slotEditor.label} maxLength={80} onChange={(event) => setSlotEditor((current) => current ? { ...current, label: event.target.value } : current)} placeholder={`${formatTime(slotEditor.startMinute)} – ${formatTime(slotEditor.endMinute)}`} className={formControlClass} /></FormControl>
              <label className="flex items-center gap-3 text-sm font-bold text-foreground sm:col-span-2"><input type="checkbox" checked={slotEditor.isActive} onChange={(event) => setSlotEditor((current) => current ? { ...current, isActive: event.target.checked } : current)} className="size-4 accent-primary" />Make this slot available to students</label>
            </div>
            <div className="flex justify-end gap-2 border-t bg-surface-subtle p-4"><Button variant="secondary" onClick={() => setSlotEditor(null)}>Cancel</Button><Button onClick={saveSlot} disabled={slotEditor.endMinute <= slotEditor.startMinute}>{slotEditor.index === null ? "Add Time Slot" : "Save Time Slot"}</Button></div>
          </section>
        </div>
      ) : null}

      {closureEditor ? (
        <div className="fixed inset-0 z-[12000] grid place-items-center overflow-y-auto bg-foreground/55 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) setClosureEditor(null); }}>
          <section ref={closureDialog.dialogRef} {...closureDialog.dialogProps} className="w-full max-w-lg rounded-feature border bg-white shadow-overlay outline-none">
            <div className="flex items-start justify-between gap-4 border-b p-5"><div><h2 id={closureDialog.titleId} className="text-xl font-extrabold text-foreground">{closureEditor.index === null ? "Add closed date" : "Edit closed date"}</h2><p className="mt-1 text-sm text-muted-foreground">Students will not be able to select this date.</p></div><Button variant="ghost" size="icon" onClick={() => setClosureEditor(null)} aria-label="Close closed date editor"><X className="size-5" /></Button></div>
            <div className="grid gap-4 p-5">
              <FormControl label="Date" htmlFor="closure-date" required><input id="closure-date" type="date" value={closureEditor.date} onChange={(event) => setClosureEditor((current) => current ? { ...current, date: event.target.value } : current)} className={formControlClass} data-dialog-autofocus /></FormControl>
              <FormControl label="Reason" htmlFor="closure-reason" required helper="Examples: University holiday, maintenance, or campus closure."><input id="closure-reason" value={closureEditor.reason} maxLength={200} onChange={(event) => setClosureEditor((current) => current ? { ...current, reason: event.target.value } : current)} placeholder="Why is pickup unavailable?" className={formControlClass} /></FormControl>
            </div>
            <div className="flex justify-end gap-2 border-t bg-surface-subtle p-4"><Button variant="secondary" onClick={() => setClosureEditor(null)}>Cancel</Button><Button onClick={saveClosure} disabled={!closureEditor.date || closureEditor.reason.trim().length < 2}>{closureEditor.index === null ? "Add Closed Date" : "Save Closed Date"}</Button></div>
          </section>
        </div>
      ) : null}

      {studentPreviewOpen && previewPolicy ? (
        <div className="fixed inset-0 z-[12000] grid place-items-center overflow-y-auto bg-foreground/55 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) setStudentPreviewOpen(false); }}>
          <section ref={studentPreviewDialog.dialogRef} {...studentPreviewDialog.dialogProps} className="w-full max-w-4xl rounded-feature border bg-white shadow-overlay outline-none">
            <div className="flex items-start justify-between gap-4 border-b p-5"><div><h2 id={studentPreviewDialog.titleId} className="text-xl font-extrabold text-foreground">Preview student availability</h2><p className="mt-1 text-sm text-muted-foreground">This preview uses your unsaved booking window, open days, time slots, and closures.</p></div><Button variant="ghost" size="icon" onClick={() => setStudentPreviewOpen(false)} aria-label="Close student preview"><X className="size-5" /></Button></div>
            <div className="max-h-[75svh] overflow-y-auto p-5"><PickupSchedulePicker selection={studentPreviewSelection} onChange={setStudentPreviewSelection} policyOverride={previewPolicy} title="Choose a pickup date" /></div>
            <div className="flex justify-end border-t bg-surface-subtle p-4"><Button onClick={() => setStudentPreviewOpen(false)}>Done</Button></div>
          </section>
        </div>
      ) : null}

      {reviewOpen && impactPreview ? (
        <div className="fixed inset-0 z-[12000] grid place-items-center overflow-y-auto bg-foreground/55 p-4 backdrop-blur-sm">
          <section ref={reviewDialog.dialogRef} {...reviewDialog.dialogProps} role="alertdialog" className="w-full max-w-2xl rounded-feature border bg-white shadow-overlay outline-none">
            <div className="flex items-start gap-3 border-b p-5"><span className="grid size-11 shrink-0 place-items-center rounded-full bg-warning/10 text-warning"><TriangleAlert className="size-5" /></span><div className="min-w-0 flex-1"><h2 id={reviewDialog.titleId} className="text-xl font-extrabold text-foreground">Save pickup schedule changes?</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">Review the student schedule and the effect on existing reservations before saving.</p></div><Button variant="ghost" size="icon" onClick={() => setReviewOpen(false)} disabled={submitting} aria-label="Close schedule review"><X className="size-5" /></Button></div>
            <div className="max-h-[65svh] space-y-4 overflow-y-auto p-5">
              <dl className="grid gap-3 rounded-surface border bg-surface-subtle p-4 text-sm sm:grid-cols-2">
                <div><dt className="font-semibold text-muted-foreground">Booking window</dt><dd className="mt-1 font-extrabold text-foreground">{draft.minAdvanceDays}–{draft.maxAdvanceDays} days ahead</dd></div>
                <div><dt className="font-semibold text-muted-foreground">Open pickup days</dt><dd className="mt-1 font-extrabold text-foreground">{openDays.join(", ")}</dd></div>
                <div><dt className="font-semibold text-muted-foreground">Active time slots</dt><dd className="mt-1 font-extrabold text-foreground">{activeSlots.length} · {slotSpan}</dd></div>
                <div><dt className="font-semibold text-muted-foreground">Closed dates</dt><dd className="mt-1 font-extrabold text-foreground">{draft.closures.length}</dd></div>
              </dl>
              <div className={cn("rounded-surface border p-4", impactPreview.affectedCount ? "border-warning/30 bg-warning/5" : "border-success/25 bg-success/5")}><p className="font-extrabold text-foreground">{impactPreview.affectedCount ? `${impactPreview.affectedCount} reservation(s) will need staff review` : "No existing reservations are affected"}</p><p className="mt-1 text-sm leading-6 text-muted-foreground">Existing pickup times will remain unchanged. Any incompatible reservations will be flagged for authorized staff to review and reschedule.</p></div>
              {impactPreview.affectedReservations.length ? <div className="max-h-44 overflow-y-auto rounded-surface border">{impactPreview.affectedReservations.map((reservation) => <div key={reservation.id} className="border-b p-3 text-sm last:border-b-0"><p className="font-extrabold text-foreground">{reservation.referenceCode}</p><p className="mt-1 text-xs text-muted-foreground">{reservation.reason}</p></div>)}</div> : null}
              <FormControl label="Change note" htmlFor="schedule-change-note" required helper="Explain why this schedule is changing. This is saved in the activity log." error={changeNote.length > 0 && changeNote.trim().length < 5 ? "Enter at least 5 characters." : undefined}>
                <textarea id="schedule-change-note" value={changeNote} minLength={5} maxLength={500} onChange={(event) => setChangeNote(event.target.value)} placeholder="Example: Updated pickup hours for the new semester." className={cn(formControlClass, "min-h-24 py-2")} data-dialog-autofocus />
              </FormControl>
            </div>
            <div className="flex flex-col-reverse gap-2 border-t bg-surface-subtle p-4 sm:flex-row sm:justify-end"><Button variant="secondary" onClick={() => setReviewOpen(false)} disabled={submitting}>Cancel</Button><Button onClick={() => void saveChanges()} disabled={changeNote.trim().length < 5} loading={submitting}><Save className="size-4" />Save Changes</Button></div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
