"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronRight,
  X
} from "lucide-react";
import {
  useStudentAuth,
  type StudentProfileInput,
  type StudentUser
} from "@/components/auth/StudentAuthProvider";
import { WebPushSettings } from "@/components/notifications/WebPushSettings";
import { AssetIcon } from "@/components/ui/AssetIcon";
import { Button } from "@/components/ui/button";
import {
  getReceiptsFromApi,
  getReservationsFromApi,
  type BackendReceipt,
  type BackendReservation
} from "@/lib/api";

type ProfileDraft = StudentProfileInput;

const emptyDraft: ProfileDraft = {
  fullName: "",
  phone: "",
  department: "",
  address: ""
};

type AccountSummary = {
  upcoming: number;
  pending: number;
  completed: number;
  cancelled: number;
  monthlyReceiptTotal: number;
};

type AccountSummaryState = {
  ownerId: string;
  data: AccountSummary;
  loading: boolean;
  error: string;
};

const emptyAccountSummary: AccountSummary = {
  upcoming: 0,
  pending: 0,
  completed: 0,
  cancelled: 0,
  monthlyReceiptTotal: 0
};

const manilaMonthFormatter = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  timeZone: "Asia/Manila"
});

function profileDraftFromUser(user: StudentUser): ProfileDraft {
  return {
    fullName: user.fullName,
    phone: user.phone,
    department: user.department,
    address: user.address
  };
}

function manilaMonthKey(value: Date) {
  if (Number.isNaN(value.getTime())) return null;
  return manilaMonthFormatter.format(value);
}

function summarizeAccount(reservations: BackendReservation[], receipts: BackendReceipt[]): AccountSummary {
  const currentMonth = manilaMonthKey(new Date());
  return {
    upcoming: reservations.filter((row) => row.status === "CONFIRMED" || row.status === "READY_FOR_PICKUP").length,
    pending: reservations.filter((row) => row.status === "PENDING").length,
    completed: reservations.filter((row) => row.status === "COMPLETED").length,
    cancelled: reservations.filter((row) => row.status === "CANCELLED" || row.status === "NO_SHOW").length,
    monthlyReceiptTotal: receipts.reduce((total, receipt) => {
      const receiptMonth = manilaMonthKey(new Date(receipt.issuedAt));
      if (!receiptMonth || receipt.status === "VOIDED" || receiptMonth !== currentMonth) return total;
      const amount = Number(receipt.totalAmount);
      return total + (Number.isFinite(amount) ? amount : 0);
    }, 0)
  };
}

function formatPeso(value: number) {
  return `PHP ${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
  const [draftOwnerId, setDraftOwnerId] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveNotice, setSaveNotice] = useState("");
  const [accountSummaryState, setAccountSummaryState] = useState<AccountSummaryState>({
    ownerId: "",
    data: emptyAccountSummary,
    loading: false,
    error: ""
  });
  const summaryRequestRef = useRef(0);
  const profileOwnerRef = useRef("");
  const activeDraft = user && draftOwnerId === user.id ? draft : user ? profileDraftFromUser(user) : emptyDraft;
  const accountSummary = user && accountSummaryState.ownerId === user.id
    ? accountSummaryState.data
    : emptyAccountSummary;
  const summaryLoading = Boolean(user) && (
    accountSummaryState.ownerId !== user?.id || accountSummaryState.loading
  );
  const summaryError = accountSummaryState.ownerId === user?.id ? accountSummaryState.error : "";

  useEffect(() => {
    const nextOwnerId = user?.id ?? "";
    const accountChanged = profileOwnerRef.current !== nextOwnerId;
    profileOwnerRef.current = nextOwnerId;
    if (accountChanged) {
      setEditing(false);
      setSaving(false);
      setSaveError("");
      setSaveNotice("");
    }
    if (!user) {
      setDraft(emptyDraft);
      setDraftOwnerId("");
      return;
    }
    setDraft(profileDraftFromUser(user));
    setDraftOwnerId(user.id);
  }, [user]);

  useEffect(() => {
    const ownerId = user?.id ?? "";
    const accessToken = user?.accessToken;

    if (!ownerId || !accessToken) {
      summaryRequestRef.current += 1;
      setAccountSummaryState({ ownerId: "", data: emptyAccountSummary, loading: false, error: "" });
      return undefined;
    }

    setAccountSummaryState({ ownerId, data: emptyAccountSummary, loading: true, error: "" });
    const loadSummary = async () => {
      const requestSequence = ++summaryRequestRef.current;
      try {
        const [reservations, receipts] = await Promise.all([
          getReservationsFromApi(accessToken),
          getReceiptsFromApi(accessToken)
        ]);
        if (requestSequence !== summaryRequestRef.current) return;
        setAccountSummaryState({
          ownerId,
          data: summarizeAccount(reservations, receipts),
          loading: false,
          error: ""
        });
      } catch (error) {
        if (requestSequence !== summaryRequestRef.current) return;
        setAccountSummaryState((current) => ({
          ownerId,
          data: current.ownerId === ownerId ? current.data : emptyAccountSummary,
          loading: false,
          error: error instanceof Error ? error.message : "Unable to load live account totals."
        }));
      }
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void loadSummary();
    };
    const timer = window.setInterval(refreshWhenVisible, 30_000);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    void loadSummary();

    return () => {
      summaryRequestRef.current += 1;
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [user?.accessToken, user?.id]);

  const updateDraft = (key: keyof ProfileDraft) => (value: string) => {
    if (!user) return;
    setDraft((current) => ({
      ...(draftOwnerId === user.id ? current : profileDraftFromUser(user)),
      [key]: value
    }));
    setDraftOwnerId(user.id);
    setSaveError("");
    setSaveNotice("");
  };

  const saveProfile = async () => {
    if (!user) return;
    if (!activeDraft.fullName.trim()) {
      setSaveError("Full name is required.");
      return;
    }

    setSaving(true);
    setSaveError("");
    setSaveNotice("");
    const ownerId = user.id;
    const result = await updateProfile(activeDraft);
    if (profileOwnerRef.current !== ownerId) return;
    setSaving(false);
    if (!result.success) {
      setSaveError(result.error ?? "Unable to save your profile.");
      return;
    }
    setEditing(false);
    setSaveNotice("Profile changes saved.");
  };

  const cancelEditing = () => {
    if (user) {
      setDraft(profileDraftFromUser(user));
      setDraftOwnerId(user.id);
    }
    setSaveError("");
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
            {user.avatarDataUrl ? (
              <Image src={user.avatarDataUrl} alt={user.fullName} fill unoptimized className="object-cover" />
            ) : (
              <span className="grid size-full place-items-center text-4xl font-extrabold text-primary">{initials}</span>
            )}
          </div>
        </div>

        <div className="text-center lg:text-left">
          <h2 className="text-2xl font-extrabold text-[#101820] sm:text-3xl">{user.fullName}</h2>
          <p className="mt-2 font-semibold text-[#58645d]">Student</p>
          <p className="mt-1 text-sm text-[#667169]">Student No. {user.studentNumber}</p>
          <div className="mt-5 grid gap-2 sm:flex sm:flex-wrap sm:justify-center lg:justify-start">
            {editing ? (
              <>
                <Button className="h-11 w-full sm:w-auto" onClick={() => void saveProfile()} disabled={saving}>
                  <Check className="size-4" />
                  {saving ? "Saving..." : "Save changes"}
                </Button>
                <Button variant="secondary" className="h-11 w-full sm:w-auto" onClick={cancelEditing} disabled={saving}>
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
          {saveError ? <p className="mt-3 text-sm font-semibold text-red-700" role="alert">{saveError}</p> : null}
          {saveNotice ? <p className="mt-3 text-sm font-semibold text-primary" role="status">{saveNotice}</p> : null}
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
          <InformationRow iconSrc="/assets/my-profile.svg" label="Full Name" value={activeDraft.fullName} editing={editing} onChange={updateDraft("fullName")} />
          <InformationRow iconSrc="/assets/contact-us.svg" label="Phone Number" value={activeDraft.phone} editing={editing} onChange={updateDraft("phone")} />
          <InformationRow iconSrc="/assets/id-accessories.svg" label="Student Number" value={user.studentNumber} />
          <InformationRow iconSrc="/assets/textbooks.svg" label="Department" value={activeDraft.department} editing={editing} onChange={updateDraft("department")} />
          <InformationRow iconSrc="/assets/messages.svg" label="Email Address" value={user.email} />
          <InformationRow iconSrc="/assets/contact-us.svg" label="Address" value={activeDraft.address} editing={editing} multiline onChange={updateDraft("address")} />
        </section>

        <div className="grid content-start gap-5">
          <SummaryLink href="/student/reservations" iconSrc="/assets/my-reservations.svg" title="My Reservations Summary">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <span className="flex items-center justify-between">Upcoming <strong className="rounded-md bg-[#fff0ce] px-2.5 py-1 text-[#b86d00]">{summaryLoading || summaryError ? "—" : accountSummary.upcoming}</strong></span>
              <span className="flex items-center justify-between">Pending <strong className="rounded-md bg-[#fff0ce] px-2.5 py-1 text-[#b86d00]">{summaryLoading || summaryError ? "—" : accountSummary.pending}</strong></span>
              <span className="flex items-center justify-between">Completed <strong className="rounded-md bg-[#e4f3e5] px-2.5 py-1 text-primary">{summaryLoading || summaryError ? "—" : accountSummary.completed}</strong></span>
              <span className="flex items-center justify-between">Cancelled <strong className="rounded-md bg-[#edf0ee] px-2.5 py-1">{summaryLoading || summaryError ? "—" : accountSummary.cancelled}</strong></span>
            </div>
          </SummaryLink>

          <SummaryLink href="/student/receipts" iconSrc="/assets/digital-receipts.svg" title="Digital Receipts Summary">
            <div className="flex items-end justify-between gap-3">
              <span className="text-sm text-[#667169]">This month</span>
              <strong className="text-2xl text-primary">{summaryLoading || summaryError ? "—" : formatPeso(accountSummary.monthlyReceiptTotal)}</strong>
            </div>
          </SummaryLink>

          {summaryError ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold leading-5 text-amber-800" role="status">
              Live account totals are temporarily unavailable. Refresh when the connection is stable.
            </p>
          ) : null}

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
