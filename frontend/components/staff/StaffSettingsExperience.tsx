"use client";

import { useState } from "react";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import { WebPushSettings } from "@/components/notifications/WebPushSettings";
import { AssetIcon } from "@/components/ui/AssetIcon";
import { Button } from "@/components/ui/button";
import { clearStaffSession } from "@/lib/staff-api";
import { Notice, PageHeading } from "@/components/staff/StaffOperationsShared";

export function StaffSettingsExperience() {
  const { user, logout } = useStudentAuth();
  const [lowStock, setLowStock] = useState(true);
  const [reservations, setReservations] = useState(true);
  const [receipts, setReceipts] = useState(true);
  const [rules, setRules] = useState("Reservations are held until the selected pickup schedule. Unclaimed items are released after one business day.");
  const [notice, setNotice] = useState("");
  const roleLabel = user?.role === "ADMIN" ? "Admin" : "Staff";
  const initials = (user?.fullName || user?.email || roleLabel)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || (user?.role === "ADMIN" ? "AD" : "ST");
  const notificationOptions: Array<[string, string, boolean, React.Dispatch<React.SetStateAction<boolean>>]> = [
    ["Restock alerts", "Notify this account when products reach the restock alert count.", lowStock, setLowStock],
    ["Reservation reminders", "Notify this account when reservations need staff action.", reservations, setReservations],
    ["Receipt verification queue", "Notify this account when receipts are waiting for verification.", receipts, setReceipts]
  ];
  const signOut = async () => {
    const signedOut = await logout();
    if (!signedOut) return;
    clearStaffSession();
    window.location.assign("/");
  };

  return (
    <div className="space-y-5">
      <PageHeading
        eyebrow={`${roleLabel} settings`}
        title="Account settings"
        detail="Manage account details, notification preferences, and pickup guidance from one place."
        action={<Button className="w-full sm:w-auto" onClick={() => setNotice("Account settings saved.")}>Save changes</Button>}
      />

      <section className="rounded-lg border border-[#dce5dd] bg-white p-4 shadow-sm sm:p-5">
        <div className="grid gap-4 lg:grid-cols-[auto_1fr_auto] lg:items-center">
          <span className="mx-auto grid size-20 shrink-0 place-items-center rounded-full bg-[#dcebdd] text-2xl font-extrabold text-primary lg:mx-0">{initials}</span>
          <div className="min-w-0 text-center lg:text-left">
            <p className="text-xs font-bold uppercase text-primary">{roleLabel} account</p>
            <h2 className="mt-1 truncate text-2xl font-extrabold text-[#101820]">{user?.fullName || user?.email || `${roleLabel} User`}</h2>
            <p className="mt-1 truncate text-sm text-[#68746d]">{user?.email || "No email loaded"}</p>
          </div>
          <Button variant="secondary" className="w-full border-red-200 text-red-700 hover:bg-red-50 lg:w-auto" onClick={signOut}>
            <AssetIcon src="/assets/logout.svg" className="size-6" /> Sign out
          </Button>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <section className="rounded-lg border border-[#dce5dd] bg-white p-4 shadow-sm sm:p-5">
          <div className="flex items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-md bg-[#eef6ee]"><AssetIcon src="/assets/notifications.svg" className="size-8" /></span>
            <div>
              <h2 className="font-extrabold text-[#17211b]">Notification preferences</h2>
              <p className="mt-1 text-sm leading-6 text-[#68746d]">Choose which operational events should create alerts for this account.</p>
            </div>
          </div>
          <div className="mt-5 divide-y divide-[#edf1ed]">
            {notificationOptions.map(([label, description, checked, setter]) => (
              <div key={label} className="grid gap-3 py-4 sm:grid-cols-[1fr_auto] sm:items-center">
                <div>
                  <p className="text-sm font-extrabold text-[#253029]">{label}</p>
                  <p className="mt-1 text-xs leading-5 text-[#68746d]">{description}</p>
                </div>
                <button type="button" role="switch" aria-checked={checked} onClick={() => setter((value) => !value)} className={checked ? "relative h-8 w-14 rounded-full bg-primary transition" : "relative h-8 w-14 rounded-full bg-[#cdd6cf] transition"}>
                  <span className={checked ? "absolute left-7 top-1 size-6 rounded-full bg-white shadow-sm transition" : "absolute left-1 top-1 size-6 rounded-full bg-white shadow-sm transition"} />
                </button>
              </div>
            ))}
          </div>
        </section>

        <WebPushSettings compact />

        <section className="rounded-lg border border-[#dce5dd] bg-white p-4 shadow-sm sm:p-5">
          <div className="flex items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-md bg-[#eef6ee]"><AssetIcon src="/assets/pick-up.svg" className="size-8" /></span>
            <div>
              <h2 className="font-extrabold text-[#17211b]">Pickup guidance</h2>
              <p className="mt-1 text-sm leading-6 text-[#68746d]">This guidance is shown during reservation processing.</p>
            </div>
          </div>
          <textarea value={rules} onChange={(event) => setRules(event.target.value.slice(0, 300))} className="mt-5 min-h-40 w-full rounded-md border border-[#d7e1d8] p-3 text-sm leading-6 outline-none focus:border-primary focus:ring-2 focus:ring-primary/10" />
          <p className="mt-2 text-right text-xs text-[#68746d]">{rules.length}/300</p>
        </section>
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        <article className="rounded-lg border border-[#dce5dd] bg-white p-4 shadow-sm"><AssetIcon src="/assets/verified.svg" className="size-9" /><h3 className="mt-3 font-extrabold text-[#17211b]">Role access</h3><p className="mt-1 text-sm text-[#68746d]">{roleLabel} permissions are controlled by the backend account role.</p></article>
        <article className="rounded-lg border border-[#dce5dd] bg-white p-4 shadow-sm"><AssetIcon src="/assets/privacy.svg" className="size-9" /><h3 className="mt-3 font-extrabold text-[#17211b]">School email</h3><p className="mt-1 text-sm text-[#68746d]">Login is verified through the account email used in WESCOMM.</p></article>
        <article className="rounded-lg border border-[#dce5dd] bg-white p-4 shadow-sm"><AssetIcon src="/assets/settings.svg" className="size-9" /><h3 className="mt-3 font-extrabold text-[#17211b]">Local preferences</h3><p className="mt-1 text-sm text-[#68746d]">These UI preferences are ready to connect to persistent backend settings.</p></article>
      </section>
      {notice ? <Notice text={notice} onClose={() => setNotice("")} /> : null}
    </div>
  );
}
