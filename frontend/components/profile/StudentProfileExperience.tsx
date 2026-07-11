"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  Camera,
  Check,
  ChevronRight,
  X
} from "lucide-react";
import { useStudentAuth, type StudentProfileInput } from "@/components/auth/StudentAuthProvider";
import { WebPushSettings } from "@/components/notifications/WebPushSettings";
import { AssetIcon } from "@/components/ui/AssetIcon";
import { Button } from "@/components/ui/button";

type ProfileDraft = StudentProfileInput;

const emptyDraft: ProfileDraft = {
  fullName: "",
  phone: "",
  department: "",
  address: "",
  avatarDataUrl: ""
};

function Toggle({
  checked,
  label,
  onChange
}: {
  checked: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={`relative h-7 w-12 shrink-0 rounded-full transition ${checked ? "bg-primary" : "bg-[#cdd6cf]"}`}
    >
      <span className={`absolute top-1 size-5 rounded-full bg-white shadow-sm transition ${checked ? "left-6" : "left-1"}`} />
    </button>
  );
}

function InformationRow({
  iconSrc,
  label,
  value,
  editing,
  multiline = false,
  onChange
}: {
  iconSrc: string;
  label: string;
  value: string;
  editing?: boolean;
  multiline?: boolean;
  onChange?: (value: string) => void;
}) {
  return (
    <div className="grid gap-2 border-b border-[#e7ece8] py-4 last:border-b-0 sm:grid-cols-[190px_1fr] sm:items-start">
      <div className="flex items-center gap-3">
        <AssetIcon src={iconSrc} className="size-7" />
        <span className="text-sm font-bold text-[#253029]">{label}</span>
      </div>
      {editing && onChange ? (
        multiline ? (
          <textarea
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="min-h-20 w-full rounded-md border border-[#ccd8cd] bg-white px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
          />
        ) : (
          <input
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="h-10 w-full rounded-md border border-[#ccd8cd] bg-white px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
          />
        )
      ) : (
        <p className="break-words pl-8 text-sm leading-6 text-[#4a554e] sm:pl-0">{value}</p>
      )}
    </div>
  );
}

function SummaryLink({
  href,
  iconSrc,
  title,
  children
}: {
  href: string;
  iconSrc: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group rounded-lg border border-[#dce5dd] bg-white p-5 shadow-sm transition hover:border-[#aac5ad] hover:shadow-[0_12px_30px_rgba(0,91,43,0.07)]"
    >
      <div className="flex items-center gap-3">
        <AssetIcon src={iconSrc} className="size-8" />
        <h2 className="font-extrabold text-[#17211b]">{title}</h2>
        <ChevronRight className="ml-auto size-5 transition group-hover:translate-x-0.5 group-hover:text-primary" />
      </div>
      <div className="mt-4">{children}</div>
    </Link>
  );
}

export function StudentProfileExperience() {
  const { user, ready, openAuth, updateProfile, logout } = useStudentAuth();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ProfileDraft>(emptyDraft);
  const [reservationReminders, setReservationReminders] = useState(true);
  const [restockAlerts, setRestockAlerts] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user) return;
    setDraft({
      fullName: user.fullName,
      phone: user.phone,
      department: user.department,
      address: user.address,
      avatarDataUrl: user.avatarDataUrl ?? ""
    });
  }, [user]);

  const updateDraft = (key: keyof ProfileDraft) => (value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const handlePhoto = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setDraft((current) => ({ ...current, avatarDataUrl: reader.result as string }));
      }
    };
    reader.readAsDataURL(file);
  };

  const saveProfile = () => {
    updateProfile(draft);
    setEditing(false);
  };

  const cancelEditing = () => {
    if (user) {
      setDraft({
        fullName: user.fullName,
        phone: user.phone,
        department: user.department,
        address: user.address,
        avatarDataUrl: user.avatarDataUrl ?? ""
      });
    }
    setEditing(false);
  };

  if (!ready) {
    return <div className="h-96 animate-pulse rounded-lg border border-[#e1e8e2] bg-white" />;
  }

  if (!user) {
    return (
      <section className="mx-auto flex min-h-[520px] max-w-3xl flex-col items-center justify-center rounded-lg border border-[#dce5dd] bg-white px-6 text-center shadow-sm">
        <span className="grid size-16 place-items-center rounded-full bg-[#e8f4e8] text-primary">
          <AssetIcon src="/assets/my-profile.svg" className="size-11" />
        </span>
        <h1 className="mt-5 text-3xl font-extrabold text-[#101820]">Log in to view your profile</h1>
        <p className="mt-3 max-w-md text-sm leading-6 text-[#657169]">
          Use your official Wesleyan email account to access student information, receipts, reservations, and preferences.
        </p>
        <Button className="mt-6 h-12 px-6" onClick={openAuth}>
          Log in with school email
        </Button>
      </section>
    );
  }

  const initials = user.fullName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-bold uppercase text-primary">Student account</p>
        <h1 className="mt-1 text-3xl font-extrabold text-[#101820] sm:text-4xl">My Profile</h1>
        <p className="mt-2 text-sm text-[#667169]">View and manage your account information and preferences.</p>
      </div>

      <section className="grid gap-6 rounded-lg border border-[#dce5dd] bg-white p-4 shadow-sm sm:p-7 lg:grid-cols-[auto_1fr_auto] lg:items-center">
        <div className="relative mx-auto size-32 shrink-0 sm:size-36 lg:mx-0">
          <div className="relative size-full overflow-hidden rounded-full border-2 border-primary bg-[#e9f3e9]">
            {draft.avatarDataUrl ? (
              <Image src={draft.avatarDataUrl} alt={user.fullName} fill unoptimized className="object-cover" />
            ) : (
              <span className="grid size-full place-items-center text-4xl font-extrabold text-primary">{initials}</span>
            )}
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
          <button
            type="button"
            onClick={() => {
              setEditing(true);
              fileInputRef.current?.click();
            }}
            aria-label="Choose profile photo"
            title="Choose profile photo"
            className="absolute bottom-1 right-0 grid size-11 place-items-center rounded-full border-4 border-white bg-primary text-white shadow-md hover:bg-[#004320]"
          >
            <Camera className="size-5" />
          </button>
        </div>

        <div className="text-center lg:text-left">
          <h2 className="text-2xl font-extrabold text-[#101820] sm:text-3xl">{user.fullName}</h2>
          <p className="mt-2 font-semibold text-[#58645d]">Student</p>
          <p className="mt-1 text-sm text-[#667169]">Student No. {user.studentNumber}</p>
          <div className="mt-5 grid gap-2 sm:flex sm:flex-wrap sm:justify-center lg:justify-start">
            {editing ? (
              <>
                <Button className="h-11 w-full sm:w-auto" onClick={saveProfile}>
                  <Check className="size-4" />
                  Save changes
                </Button>
                <Button variant="secondary" className="h-11 w-full sm:w-auto" onClick={cancelEditing}>
                  <X className="size-4" />
                  Cancel
                </Button>
              </>
            ) : (
              <Button variant="secondary" className="h-11 w-full border-primary sm:w-auto" onClick={() => setEditing(true)}>
                <AssetIcon src="/assets/edit.svg" className="size-5" />
                Edit Profile
              </Button>
            )}
          </div>
        </div>

        <div className="hidden rounded-lg bg-[#f1f7f1] p-4 text-right lg:block">
          <p className="text-xs font-bold uppercase text-primary">Account source</p>
          <p className="mt-1 text-sm font-bold text-[#253029]">Wesleyan Email</p>
          <p className="mt-1 text-xs text-[#6b766f]">Verified email identity</p>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
        <section className="rounded-lg border border-[#dce5dd] bg-white p-5 shadow-sm sm:p-7">
          <div className="flex items-center gap-3 border-b border-[#e7ece8] pb-4">
            <AssetIcon src="/assets/my-profile.svg" className="size-8" />
            <h2 className="text-xl font-extrabold text-[#17211b]">Account Information</h2>
          </div>
          <InformationRow iconSrc="/assets/my-profile.svg" label="Full Name" value={draft.fullName} editing={editing} onChange={updateDraft("fullName")} />
          <InformationRow iconSrc="/assets/contact-us.svg" label="Phone Number" value={draft.phone} editing={editing} onChange={updateDraft("phone")} />
          <InformationRow iconSrc="/assets/id-accessories.svg" label="Student Number" value={user.studentNumber} />
          <InformationRow iconSrc="/assets/textbooks.svg" label="Department" value={draft.department} editing={editing} onChange={updateDraft("department")} />
          <InformationRow iconSrc="/assets/messages.svg" label="Email Address" value={user.email} />
          <InformationRow iconSrc="/assets/contact-us.svg" label="Address" value={draft.address} editing={editing} multiline onChange={updateDraft("address")} />
        </section>

        <div className="grid content-start gap-5">
          <SummaryLink href="/student/reservations" iconSrc="/assets/my-reservations.svg" title="My Reservations Summary">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <span className="flex items-center justify-between">Upcoming <strong className="rounded-md bg-[#fff0ce] px-2.5 py-1 text-[#b86d00]">2</strong></span>
              <span className="flex items-center justify-between">Pending <strong className="rounded-md bg-[#fff0ce] px-2.5 py-1 text-[#b86d00]">1</strong></span>
              <span className="flex items-center justify-between">Completed <strong className="rounded-md bg-[#e4f3e5] px-2.5 py-1 text-primary">8</strong></span>
              <span className="flex items-center justify-between">Cancelled <strong className="rounded-md bg-[#edf0ee] px-2.5 py-1">1</strong></span>
            </div>
          </SummaryLink>

          <SummaryLink href="/student/receipts" iconSrc="/assets/digital-receipts.svg" title="Digital Receipts Summary">
            <div className="flex items-end justify-between gap-3">
              <span className="text-sm text-[#667169]">This month</span>
              <strong className="text-2xl text-primary">PHP 1,230.00</strong>
            </div>
          </SummaryLink>

          <section className="rounded-lg border border-[#dce5dd] bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <AssetIcon src="/assets/notifications.svg" className="size-8" />
              <h2 className="font-extrabold text-[#17211b]">Notification Settings</h2>
            </div>
            <div className="mt-5 flex items-center justify-between gap-4">
              <span className="text-sm text-[#4f5b54]">Reservation reminders</span>
              <Toggle checked={reservationReminders} label="Reservation reminders" onChange={() => setReservationReminders((value) => !value)} />
            </div>
            <div className="mt-4 flex items-center justify-between gap-4">
              <span className="text-sm text-[#4f5b54]">Restock notifications</span>
              <Toggle checked={restockAlerts} label="Restock notifications" onChange={() => setRestockAlerts((value) => !value)} />
            </div>
          </section>

          <WebPushSettings />
        </div>
      </div>

      <section className="rounded-lg border border-[#dce5dd] bg-white p-5 shadow-sm">
        <div className="flex items-start gap-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-md bg-[#eaf4ea] text-primary">
            <AssetIcon src="/assets/privacy.svg" className="size-8" />
          </span>
          <div>
            <h2 className="font-extrabold text-[#17211b]">School Account Security</h2>
            <p className="mt-1 text-sm leading-6 text-[#667169]">
              Access is verified through your official Wesleyan email inbox.
            </p>
          </div>
        </div>
      </section>

      <div className="flex justify-stretch sm:justify-end">
        <Button variant="secondary" className="h-11 w-full border-[#d6dddd] text-[#8f2727] hover:bg-[#fff4f4] sm:w-auto" onClick={logout}>
          <AssetIcon src="/assets/logout.svg" className="size-6" />
          Log out
        </Button>
      </div>

      <footer className="flex flex-col gap-3 border-t border-[#e2e8e3] py-6 text-xs text-[#6e7872] sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Image src="/assets/wescomm-logo.png" alt="WESCOMM" width={80} height={38} className="h-9 w-auto object-contain" />
          <span>Wesleyan University-Philippines Integrated Commissary Management System</span>
        </div>
        <span>School account secured by email verification</span>
      </footer>
    </div>
  );
}
