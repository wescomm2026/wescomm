"use client";

import Link from "next/link";
import { ArrowRight, Ban, Check, Clock3, LockKeyhole, QrCode, ReceiptText, Search, ShieldCheck } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormControl, formControlClass } from "@/components/ui/FormControl";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Surface } from "@/components/ui/Surface";
import {
  verifyReceiptFromApi,
  verifyReceiptTokenFromApi,
  BackendApiError,
  type BackendPublicReceiptVerification
} from "@/lib/api";
import { paymentMethodLabel } from "@/lib/payment-method";

function formatMoney(value: string | number) {
  const numericValue = Number(value);
  return `PHP ${numericValue.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-PH", {
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "Asia/Manila"
      });
}

function formatReceiptStatus(value: BackendPublicReceiptVerification["status"]) {
  if (value === "VERIFIED") return "Verified";
  if (value === "VOIDED") return "Voided";
  return "Pending";
}

function receiptResultTone(status: BackendPublicReceiptVerification["status"]) {
  if (status === "VERIFIED") return {
    label: "Verified receipt",
    header: "border-emerald-200 bg-emerald-50",
    icon: "bg-white text-emerald-700",
    eyebrow: "text-emerald-700",
    Icon: ShieldCheck
  };
  if (status === "VOIDED") return {
    label: "Voided receipt",
    header: "border-red-200 bg-red-50",
    icon: "bg-white text-red-700",
    eyebrow: "text-red-700",
    Icon: Ban
  };
  return {
    label: "Pending verification",
    header: "border-amber-200 bg-amber-50",
    icon: "bg-white text-amber-700",
    eyebrow: "text-amber-800",
    Icon: Clock3
  };
}

export function PublicReceiptVerification() {
  const [receiptCode, setReceiptCode] = useState("");
  const [receipt, setReceipt] = useState<BackendPublicReceiptVerification | null>(null);
  const [submittedCode, setSubmittedCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notFoundCode, setNotFoundCode] = useState("");
  const resultRef = useRef<HTMLElement | null>(null);
  const errorRef = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => {
    if (error) errorRef.current?.focus();
    else if (receipt || notFoundCode) resultRef.current?.focus();
  }, [error, notFoundCode, receipt]);

  useEffect(() => {
    const parameters = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const token = parameters.get("v")?.trim();
    if (!token) return;

    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    setLoading(true);
    setError("");
    setNotFoundCode("");
    void verifyReceiptTokenFromApi(token)
      .then((result) => {
        setReceipt(result);
        setSubmittedCode(result.receiptCode);
      })
      .catch((verificationError) => {
        if (verificationError instanceof BackendApiError && verificationError.status === 404) {
          setNotFoundCode("Secure receipt link");
        } else {
          setError(verificationError instanceof Error ? verificationError.message : "Unable to verify this receipt right now.");
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const verifyReceipt = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedCode = receiptCode.trim().toUpperCase();
    setReceiptCode(normalizedCode);
    setReceipt(null);
    setSubmittedCode("");
    setError("");
    setNotFoundCode("");

    if (!/^[A-Z0-9-]{5,64}$/.test(normalizedCode)) {
      setError("Enter a valid receipt code using the letters, numbers, and dashes printed on the receipt.");
      return;
    }

    setLoading(true);
    try {
      const result = await verifyReceiptFromApi(normalizedCode);
      setReceipt(result);
      setSubmittedCode(normalizedCode);
    } catch (verificationError) {
      if (verificationError instanceof BackendApiError && verificationError.status === 404) {
        setNotFoundCode(normalizedCode);
      } else {
        setError(verificationError instanceof Error
          ? verificationError.message
          : "Unable to verify this receipt right now.");
      }
    } finally {
      setLoading(false);
    }
  };

  const resultTone = receipt ? receiptResultTone(receipt.status) : null;
  const ResultIcon = resultTone?.Icon ?? ShieldCheck;

  return (
    <div className="space-y-6">
      <section className="grid overflow-hidden rounded-feature border bg-white shadow-soft lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
        <div className="p-5 sm:p-7 lg:p-8">
          <div className="flex items-start gap-4">
            <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
              <Search className="size-6" />
            </span>
            <div>
              <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-primary">Receipt code lookup</p>
              <h2 className="mt-1 text-2xl font-extrabold tracking-tight text-foreground">Search an official receipt</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                Enter the complete code printed below the digital receipt number.
              </p>
            </div>
          </div>

          <form className="mt-7" onSubmit={verifyReceipt} noValidate>
            <FormControl
              label="Receipt code"
              htmlFor="public-receipt-code"
              helper="Letters, numbers, and dashes only. Example: RCT-2026-XXXXXXXXXX"
            >
              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  id="public-receipt-code"
                  name="receiptCode"
                  type="text"
                  value={receiptCode}
                  onChange={(event) => setReceiptCode(event.target.value.toUpperCase())}
                  placeholder="RCT-2026-XXXXXXXXXX"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={64}
                  className={`${formControlClass} min-h-12 min-w-0 flex-1 font-mono font-bold uppercase tracking-wide`}
                  aria-describedby="public-receipt-privacy-note"
                />
                <Button type="submit" className="h-12 shrink-0 px-6" disabled={loading} aria-busy={loading}>
                  <Search className="size-5" />
                  {loading ? "Checking..." : "Verify Receipt"}
                </Button>
              </div>
            </FormControl>
            <p id="public-receipt-privacy-note" className="mt-4 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
              <LockKeyhole className="mt-0.5 size-4 shrink-0 text-primary" />
              Public lookup never displays full identity, contact details, item names, or internal payment identifiers.
            </p>
          </form>

          {error ? (
            <p ref={errorRef} tabIndex={-1} role="alert" className="mt-5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
              {error}
            </p>
          ) : null}
        </div>

        <aside className="flex flex-col justify-between bg-primary p-6 text-primary-foreground sm:p-7 lg:p-8">
          <div>
            <span className="grid size-12 place-items-center rounded-lg border border-white/20 bg-white/10"><QrCode className="size-7" /></span>
            <h2 className="mt-5 text-xl font-extrabold">Using the receipt QR?</h2>
            <p className="mt-2 text-sm leading-6 text-white/75">Scan the QR printed on a WESCOMM digital receipt. The secure link opens this page and checks it automatically.</p>
          </div>
          <div className="mt-7 border-t border-white/20 pt-5">
            <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-white/70">Public result includes</p>
            <ul className="mt-3 space-y-2 text-sm font-semibold text-white/90">
              <li className="flex items-center gap-2"><Check className="size-4" /> Verification status</li>
              <li className="flex items-center gap-2"><Check className="size-4" /> Masked owner</li>
              <li className="flex items-center gap-2"><Check className="size-4" /> Limited transaction summary</li>
            </ul>
          </div>
        </aside>
      </section>

      {receipt && resultTone ? (
        <section
          ref={resultRef}
          tabIndex={-1}
          aria-labelledby="public-receipt-result-heading"
          className="overflow-hidden rounded-feature border bg-white shadow-soft outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          <header className={`flex flex-col gap-4 border-b p-5 sm:flex-row sm:items-center sm:justify-between sm:p-7 ${resultTone.header}`}>
            <div className="flex items-start gap-4">
              <span className={`grid size-12 shrink-0 place-items-center rounded-xl shadow-sm ${resultTone.icon}`}>
                <ResultIcon className="size-7" />
              </span>
              <div>
                <p className={`text-xs font-extrabold uppercase tracking-wide ${resultTone.eyebrow}`}>{resultTone.label}</p>
                <h2 id="public-receipt-result-heading" className="mt-1 break-all font-mono text-xl font-extrabold text-foreground">
                  {submittedCode}
                </h2>
              </div>
            </div>
            <StatusBadge status={formatReceiptStatus(receipt.status)} />
          </header>

          <dl className="grid sm:grid-cols-2">
            <div className="border-b p-5 sm:border-r sm:p-6">
              <dt className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Masked student</dt>
              <dd className="mt-2 font-extrabold text-foreground">{receipt.student.displayName}</dd>
              <dd className="mt-1 font-mono text-sm font-semibold text-muted-foreground">
                {receipt.student.studentNumber ?? "Student number unavailable"}
              </dd>
            </div>
            <div className="border-b p-5 sm:p-6">
              <dt className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Issued and paid through</dt>
              <dd className="mt-2 font-extrabold text-foreground">{formatDate(receipt.issuedAt)}</dd>
              <dd className="mt-1 text-sm font-semibold text-muted-foreground">{paymentMethodLabel(receipt.paymentMethod)}</dd>
            </div>
            <div className="border-b p-5 sm:border-b-0 sm:border-r sm:p-6">
              <dt className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Receipt total</dt>
              <dd className="mt-2 text-2xl font-extrabold text-primary">{formatMoney(receipt.totalAmount)}</dd>
            </div>
            <div className="p-5 sm:p-6">
              <dt className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Masked reservation summary</dt>
              {receipt.reservation ? (
                <>
                  <dd className="mt-2 font-mono font-extrabold text-foreground">{receipt.reservation.referenceCode}</dd>
                  <dd className="mt-1 text-sm text-muted-foreground">
                    {receipt.reservation.itemCount} line item{receipt.reservation.itemCount === 1 ? "" : "s"} / {receipt.reservation.totalQuantity} total unit{receipt.reservation.totalQuantity === 1 ? "" : "s"}
                  </dd>
                </>
              ) : (
                <dd className="mt-2 text-sm text-muted-foreground">Manual commissary receipt</dd>
              )}
            </div>
          </dl>

          <div className="flex flex-col gap-3 border-t bg-[#f7faf7] px-5 py-4 text-sm leading-6 text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-7">
            <span>Need the complete receipt? Only the receipt owner can access it after login.</span>
            <Link href="/student/receipts" className="inline-flex shrink-0 items-center gap-1 font-extrabold text-primary hover:underline">Open Digital Receipts <ArrowRight className="size-4" /></Link>
          </div>
        </section>
      ) : notFoundCode ? (
        <section ref={resultRef} tabIndex={-1} className="rounded-feature border bg-white px-6 py-10 text-center shadow-soft outline-none" role="status">
          <span className="mx-auto grid size-14 place-items-center rounded-full bg-slate-100"><ReceiptText className="size-7 text-slate-500" /></span>
          <h2 className="mt-4 text-xl font-extrabold text-slate-900">Receipt not found</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">
            No public receipt matched <span className="font-mono font-bold">{notFoundCode}</span>. Check every letter and number, then try again.
          </p>
        </section>
      ) : (
        <Surface variant="notice" className="grid gap-4 p-5 sm:grid-cols-3 sm:p-6">
          {[
            { Icon: ShieldCheck, title: "Authenticity", detail: "Confirm whether the receipt exists and its current status." },
            { Icon: LockKeyhole, title: "Privacy", detail: "Identity and transaction details remain deliberately masked." },
            { Icon: ReceiptText, title: "Owner access", detail: "Complete digital copies require the owner to log in." }
          ].map(({ Icon, title, detail }) => (
            <div key={title} className="flex items-start gap-3">
              <Icon className="mt-0.5 size-5 shrink-0 text-primary" />
              <div><h2 className="text-sm font-extrabold text-foreground">{title}</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p></div>
            </div>
          ))}
        </Surface>
      )}
    </div>
  );
}
