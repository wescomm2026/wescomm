"use client";

import { userFacingErrorMessage } from "@/lib/user-facing-error";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import { WebPushSettings } from "@/components/notifications/WebPushSettings";
import { AssetIcon } from "@/components/ui/AssetIcon";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/InlineAlert";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  getStaffNotificationPreferencesFromApi,
  getStaffPickupGuidanceFromApi,
  isRequestAbortError,
  updateStaffNotificationPreferencesFromApi,
  updateStaffPickupGuidanceFromApi,
  type StaffNotificationPreferences,
  type StaffPickupGuidance
} from "@/lib/api";
import { clearStaffSession } from "@/lib/staff-api";
import { cn } from "@/lib/utils";
import { Notice, PageHeading } from "@/components/staff/StaffOperationsShared";

const PICKUP_GUIDANCE_MAX_LENGTH = 300;

const notificationOptions: Array<{ key: keyof StaffNotificationPreferences; label: string; description: string }> = [
  { key: "lowStock", label: "Restock alerts", description: "Notify this account when products reach the restock alert count." },
  { key: "reservations", label: "Reservation reminders", description: "Notify this account when new reservations need staff action." },
  { key: "receipts", label: "Receipt verification queue", description: "Notify this account when receipts are waiting for verification." }
];

function formatSavedAt(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" });
}

function samePreferences(left: StaffNotificationPreferences | null, right: StaffNotificationPreferences | null) {
  if (!left || !right) return left === right;
  return left.lowStock === right.lowStock && left.reservations === right.reservations && left.receipts === right.receipts;
}

export function StaffSettingsExperience() {
  const router = useRouter();
  const { user, logout } = useStudentAuth();
  const [savedPreferences, setSavedPreferences] = useState<StaffNotificationPreferences | null>(null);
  const [preferences, setPreferences] = useState<StaffNotificationPreferences | null>(null);
  const [savedGuidance, setSavedGuidance] = useState<StaffPickupGuidance | null>(null);
  const [guidanceText, setGuidanceText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const token = user?.accessToken ?? "";
  const roleLabel = user?.role === "ADMIN" ? "Admin" : "Staff";
  const initials = (user?.fullName || user?.email || roleLabel)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || (user?.role === "ADMIN" ? "AD" : "ST");

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const [preferenceResult, guidance] = await Promise.all([
        getStaffNotificationPreferencesFromApi(token, signal),
        getStaffPickupGuidanceFromApi(token, signal)
      ]);
      setSavedPreferences(preferenceResult.preferences);
      setPreferences(preferenceResult.preferences);
      setSavedGuidance(guidance);
      setGuidanceText(guidance.text);
    } catch (loadError) {
      if (!isRequestAbortError(loadError)) setError(userFacingErrorMessage(loadError, "Unable to load your settings."));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const preferencesDirty = !samePreferences(preferences, savedPreferences);
  const guidanceDirty = Boolean(savedGuidance) && guidanceText.trim() !== savedGuidance?.text;
  const guidanceInvalid = !guidanceText.trim();
  const dirty = preferencesDirty || guidanceDirty;

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const save = async () => {
    if (!token || !dirty || saving || guidanceInvalid) return;
    setSaving(true);
    setError("");
    try {
      const [preferenceResult, guidance] = await Promise.all([
        preferencesDirty && preferences ? updateStaffNotificationPreferencesFromApi(token, preferences) : Promise.resolve(null),
        guidanceDirty ? updateStaffPickupGuidanceFromApi(token, guidanceText.trim()) : Promise.resolve(null)
      ]);
      if (preferenceResult) {
        setSavedPreferences(preferenceResult.preferences);
        setPreferences(preferenceResult.preferences);
      }
      if (guidance) {
        setSavedGuidance(guidance);
        setGuidanceText(guidance.text);
      }
      setNotice("Account settings saved.");
    } catch (saveError) {
      setError(userFacingErrorMessage(saveError, "Unable to save your settings."));
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    setPreferences(savedPreferences);
    setGuidanceText(savedGuidance?.text ?? "");
    setError("");
  };

  const signOut = async () => {
    const signedOut = await logout();
    if (!signedOut) return;
    clearStaffSession();
    router.replace("/");
    router.refresh();
  };

  const guidanceSavedAt = formatSavedAt(savedGuidance?.updatedAt ?? null);

  return (
    <div className="space-y-5 pb-20 sm:pb-0">
      <PageHeading
        eyebrow={`${roleLabel} settings`}
        title="Account settings"
        detail="Manage account details, notification preferences, and pickup guidance from one place."
        action={(
          <>
            {dirty ? <Button variant="ghost" onClick={discard} disabled={saving}>Discard</Button> : null}
            <Button className="w-full sm:w-auto" onClick={() => void save()} disabled={!dirty || guidanceInvalid || loading} loading={saving}>
              {saving ? "Saving..." : "Save changes"}
            </Button>
          </>
        )}
      />
      {error ? (
        <InlineAlert onDismiss={() => setError("")} action={!savedPreferences ? <Button size="sm" variant="secondary" onClick={() => void load()}>Retry</Button> : undefined}>
          {error}
        </InlineAlert>
      ) : null}
      {dirty ? <InlineAlert tone="warning">You have unsaved changes.</InlineAlert> : null}

      <section className="rounded-xl border bg-card p-4 shadow-soft sm:p-5">
        <div className="grid gap-4 lg:grid-cols-[auto_1fr_auto] lg:items-center">
          <span className="mx-auto grid size-20 shrink-0 place-items-center rounded-full bg-muted text-2xl font-extrabold text-primary lg:mx-0">{initials}</span>
          <div className="min-w-0 text-center lg:text-left">
            <p className="text-xs font-bold uppercase text-primary">{roleLabel} account</p>
            <h2 className="mt-1 truncate text-2xl font-extrabold text-foreground">{user?.fullName || user?.email || `${roleLabel} User`}</h2>
            <p className="mt-1 truncate text-sm text-muted-foreground">{user?.email || "No email loaded"}</p>
          </div>
          <Button variant="secondary" className="w-full border-danger/30 text-danger hover:bg-danger/5 lg:w-auto" onClick={signOut}>
            <AssetIcon src="/assets/logout.svg" className="size-6" /> Sign out
          </Button>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <section className="rounded-xl border bg-card p-4 shadow-soft sm:p-5" aria-busy={loading || undefined}>
          <div className="flex items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-muted"><AssetIcon src="/assets/notifications.svg" className="size-8" /></span>
            <div>
              <h2 className="font-extrabold text-foreground">Notification preferences</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">Choose which team-wide alerts this account receives. Student messages and alerts assigned to you are always delivered.</p>
            </div>
          </div>
          <div className="mt-5 divide-y">
            {notificationOptions.map((option) => {
              const checked = preferences?.[option.key] ?? true;
              return (
                <div key={option.key} className="grid grid-cols-[1fr_auto] items-center gap-3 py-4">
                  <div>
                    <p id={`pref-${option.key}`} className="text-sm font-extrabold text-foreground">{option.label}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{option.description}</p>
                  </div>
                  {loading && !preferences ? <Skeleton className="h-8 w-14 rounded-full" /> : (
                    <button
                      type="button"
                      role="switch"
                      aria-checked={checked}
                      aria-labelledby={`pref-${option.key}`}
                      disabled={saving || !preferences}
                      onClick={() => setPreferences((current) => current ? { ...current, [option.key]: !current[option.key] } : current)}
                      className={cn("relative h-8 w-14 shrink-0 rounded-full transition disabled:opacity-60", checked ? "bg-primary" : "bg-border-strong")}
                    >
                      <span className={cn("absolute top-1 size-6 rounded-full bg-white shadow-sm transition-all", checked ? "left-7" : "left-1")} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <WebPushSettings compact />

        <section className="rounded-xl border bg-card p-4 shadow-soft sm:p-5">
          <div className="flex items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-muted"><AssetIcon src="/assets/pick-up.svg" className="size-8" /></span>
            <div>
              <h2 className="font-extrabold text-foreground">Pickup guidance</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">Shared with the whole team and shown when staff release or reschedule a reservation.</p>
            </div>
          </div>
          {loading && !savedGuidance ? <Skeleton className="mt-5 h-40 w-full" /> : (
            <textarea
              value={guidanceText}
              aria-label="Pickup guidance"
              disabled={saving || !savedGuidance}
              onChange={(event) => setGuidanceText(event.target.value.slice(0, PICKUP_GUIDANCE_MAX_LENGTH))}
              className="mt-5 min-h-40 w-full rounded-control border border-border-strong p-3 text-sm leading-6 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:bg-muted"
            />
          )}
          <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
            <span>{guidanceSavedAt ? `Last updated ${guidanceSavedAt}${savedGuidance?.updatedBy ? ` by ${savedGuidance.updatedBy}` : ""}` : "Using the default guidance"}</span>
            <span className={guidanceInvalid && savedGuidance ? "font-bold text-danger" : undefined}>{guidanceText.length}/{PICKUP_GUIDANCE_MAX_LENGTH}</span>
          </div>
        </section>
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        <article className="rounded-xl border bg-card p-4 shadow-soft"><AssetIcon src="/assets/verified.svg" className="size-9" /><h3 className="mt-3 font-extrabold text-foreground">Account access</h3><p className="mt-1 text-sm text-muted-foreground">Your {roleLabel.toLowerCase()} role determines which WESCOMM tools you can use.</p></article>
        <article className="rounded-xl border bg-card p-4 shadow-soft"><AssetIcon src="/assets/privacy.svg" className="size-9" /><h3 className="mt-3 font-extrabold text-foreground">School email</h3><p className="mt-1 text-sm text-muted-foreground">Login is verified through the account email used in WESCOMM.</p></article>
        <article className="rounded-xl border bg-card p-4 shadow-soft"><AssetIcon src="/assets/settings.svg" className="size-9" /><h3 className="mt-3 font-extrabold text-foreground">Saved to your account</h3><p className="mt-1 text-sm text-muted-foreground">Notification choices follow you on every device. Changes are recorded in the audit log.</p></article>
      </section>
      {notice ? <Notice text={notice} onClose={() => setNotice("")} /> : null}
    </div>
  );
}
