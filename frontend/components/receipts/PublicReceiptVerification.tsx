"use client";

import Link from "next/link";
import { ReceiptText, Search, ShieldCheck } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  verifyReceiptFromApi,
  verifyReceiptTokenFromApi,
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

export function PublicReceiptVerification() {
  const [receiptCode, setReceiptCode] = useState("");
  const [receipt, setReceipt] = useState<BackendPublicReceiptVerification | null>(null);
  const [submittedCode, setSubmittedCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const resultRef = useRef<HTMLElement | null>(null);
  const errorRef = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => {
    if (error) errorRef.current?.focus();
    else if (receipt) resultRef.current?.focus();
  }, [error, receipt]);

  useEffect(() => {
    const parameters = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const token = parameters.get("v")?.trim();
    if (!token) return;

    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    setLoading(true);
    setError("");
    void verifyReceiptTokenFromApi(token)
      .then((result) => {
        setReceipt(result);
        setSubmittedCode(result.receiptCode);
      })
      .catch((verificationError) => {
        setError(verificationError instanceof Error ? verificationError.message : "Unable to verify this receipt right now.");
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
      setError(verificationError instanceof Error
        ? verificationError.message
        : "Unable to verify this receipt right now.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-[#dce7dd] bg-white p-5 shadow-sm sm:p-7">
        <div className="flex items-start gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-[#eaf5eb] text-primary">
            <Search className="size-6" />
          </span>
          <div>
            <h2 className="text-xl font-extrabold text-[#17211b]">Search an official receipt</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-[#657169]">
              Enter the complete WESCOMM receipt code. Public results show only masked student information and a limited transaction summary.
            </p>
          </div>
        </div>

        <form className="mt-6" onSubmit={verifyReceipt} noValidate>
          <label htmlFor="public-receipt-code" className="text-sm font-bold text-[#26322b]">
            Receipt code
          </label>
          <div className="mt-2 flex flex-col gap-3 sm:flex-row">
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
              className="min-h-12 min-w-0 flex-1 rounded-md border border-[#cad8cb] bg-white px-4 font-mono text-sm font-bold uppercase tracking-wide text-[#17211b] outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              aria-describedby="public-receipt-privacy-note"
            />
            <Button type="submit" className="h-12 shrink-0 px-6" disabled={loading} aria-busy={loading}>
              <Search className="size-5" />
              {loading ? "Checking..." : "Verify Receipt"}
            </Button>
          </div>
          <p id="public-receipt-privacy-note" className="mt-2 text-xs leading-5 text-[#77817b]">
            For privacy, full names, student numbers, reservation references, item names, and line-item prices are not exposed here.
          </p>
        </form>

        {error ? (
          <p ref={errorRef} tabIndex={-1} role="alert" className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
            {error}
          </p>
        ) : null}
      </section>

      {receipt ? (
        <section
          ref={resultRef}
          tabIndex={-1}
          aria-labelledby="public-receipt-result-heading"
          className="overflow-hidden rounded-2xl border border-[#cfe0d0] bg-white shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          <header className="flex flex-col gap-4 border-b border-[#dee8df] bg-[#f2f8f3] p-5 sm:flex-row sm:items-center sm:justify-between sm:p-7">
            <div className="flex items-start gap-4">
              <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-white text-primary shadow-sm">
                <ShieldCheck className="size-7" />
              </span>
              <div>
                <p className="text-xs font-extrabold uppercase tracking-wide text-primary">Receipt found</p>
                <h2 id="public-receipt-result-heading" className="mt-1 break-all text-xl font-extrabold text-[#17211b]">
                  {submittedCode}
                </h2>
              </div>
            </div>
            <StatusBadge status={formatReceiptStatus(receipt.status)} />
          </header>

          <div className="grid gap-6 p-5 sm:grid-cols-2 sm:p-7">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-[#718078]">Masked student</p>
              <p className="mt-1 font-extrabold text-[#17211b]">{receipt.student.displayName}</p>
              <p className="mt-1 font-mono text-sm font-semibold text-[#657169]">
                {receipt.student.studentNumber ?? "Student number unavailable"}
              </p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-[#718078]">Issued</p>
              <p className="mt-1 font-extrabold text-[#17211b]">{formatDate(receipt.issuedAt)}</p>
              <p className="mt-1 text-sm font-semibold text-[#657169]">{paymentMethodLabel(receipt.paymentMethod)}</p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-[#718078]">Receipt total</p>
              <p className="mt-1 text-xl font-extrabold text-primary">{formatMoney(receipt.totalAmount)}</p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-[#718078]">Reservation summary</p>
              {receipt.reservation ? (
                <>
                  <p className="mt-1 font-mono font-extrabold text-[#17211b]">{receipt.reservation.referenceCode}</p>
                  <p className="mt-1 text-sm text-[#657169]">
                    {receipt.reservation.itemCount} line item{receipt.reservation.itemCount === 1 ? "" : "s"} / {receipt.reservation.totalQuantity} total unit{receipt.reservation.totalQuantity === 1 ? "" : "s"}
                  </p>
                </>
              ) : (
                <p className="mt-1 text-sm text-[#657169]">Manual commissary receipt</p>
              )}
            </div>
          </div>

          <div className="border-t border-[#e1e9e2] bg-[#fbfdfb] px-5 py-4 text-sm leading-6 text-[#657169] sm:px-7">
            Need the complete receipt? The receipt owner can <Link href="/student/receipts" className="font-bold text-primary hover:underline">log in to Digital Receipts</Link>, or contact WESCOMM support.
          </div>
        </section>
      ) : (
        <section className="rounded-2xl border border-dashed border-[#cbd9cd] bg-[#f9fbf9] px-6 py-10 text-center">
          <ReceiptText className="mx-auto size-10 text-primary" />
          <h2 className="mt-3 font-extrabold text-[#17211b]">Masked verification for visitors</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[#657169]">
            A valid search confirms receipt status without revealing the owner&apos;s complete personal or purchase details.
          </p>
        </section>
      )}
    </div>
  );
}
