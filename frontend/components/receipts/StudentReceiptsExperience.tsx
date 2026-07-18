"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { createPortal } from "react-dom";
import { Download, Eye, ShieldCheck, X } from "lucide-react";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import { AssetIcon } from "@/components/ui/AssetIcon";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { getReceiptsFromApi, type BackendPaymentMethod, type BackendReceipt, type BackendReceiptStatus } from "@/lib/api";

type Receipt = {
  id: string;
  code: string;
  student: string;
  studentNumber: string;
  date: string;
  time: string;
  status: string;
  paymentMethod: string;
  transactionReference: string;
  verifiedBy: string;
  items: Array<{
    name: string;
    detail: string;
    quantity: number;
    unitPrice: number;
  }>;
  subtotal: number;
  discount: number;
  total: number;
};

function formatCurrency(value: number) {
  return `PHP ${value.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function formatPaymentMethod(value: BackendPaymentMethod) {
  if (value === "E_WALLET_AT_PICKUP") return "E-wallet at Pickup";
  if (value === "GCASH") return "GCash";
  if (value === "CASH") return "Cash";
  return "Pay at Commissary";
}

function formatReceiptStatus(value: BackendReceiptStatus) {
  if (value === "VERIFIED") return "Verified";
  if (value === "VOIDED") return "Voided";
  return "Pending";
}

function receiptStatusDisplay(status: string) {
  if (status === "Verified") return { color: "#00652f", label: "VERIFIED DIGITAL RECEIPT", iconClass: "size-5 text-primary" };
  if (status === "Voided") return { color: "#b42318", label: "VOIDED DIGITAL RECEIPT", iconClass: "size-5 text-red-700" };
  return { color: "#a46a00", label: "PENDING VERIFICATION", iconClass: "size-5 text-[#b37700]" };
}

function formatReceiptDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: value, time: "" };

  return {
    date: date.toLocaleDateString("en-PH", {
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "Asia/Manila"
    }),
    time: date.toLocaleTimeString("en-PH", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "Asia/Manila"
    })
  };
}

function mapBackendReceipt(receipt: BackendReceipt): Receipt {
  const issued = formatReceiptDateTime(receipt.issuedAt || receipt.createdAt);
  const items = receipt.reservation?.items.length
    ? receipt.reservation.items.map((item) => ({
        name: item.product?.name ?? "Campus Item",
        detail: item.variantSummary || item.product?.description || "Reserved item",
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice)
      }))
    : [
        {
          name: receipt.reservation?.referenceCode ?? "Commissary Purchase",
          detail: "Completed transaction",
          quantity: 1,
          unitPrice: Number(receipt.totalAmount)
        }
      ];
  const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);

  return {
    id: receipt.id,
    code: receipt.receiptCode,
    student: receipt.student?.fullName || receipt.student?.email || "Student",
    studentNumber: receipt.student?.studentNumber ?? "",
    date: issued.date,
    time: issued.time,
    status: formatReceiptStatus(receipt.status),
    paymentMethod: formatPaymentMethod(receipt.paymentMethod),
    transactionReference: receipt.verificationHash.slice(0, 24).toUpperCase(),
    verifiedBy: receipt.status === "VERIFIED" ? receipt.issuedBy?.fullName ?? "" : "",
    items,
    subtotal,
    discount: 0,
    total: Number(receipt.totalAmount)
  };
}

function drawWrappedText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
) {
  const words = text.split(" ");
  let line = "";
  let currentY = y;

  words.forEach((word) => {
    const testLine = `${line}${word} `;
    if (context.measureText(testLine).width > maxWidth && line) {
      context.fillText(line.trim(), x, currentY);
      line = `${word} `;
      currentY += lineHeight;
    } else {
      line = testLine;
    }
  });

  context.fillText(line.trim(), x, currentY);
  return currentY;
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

async function downloadReceiptPngLegacy(receipt: Receipt) {
  const width = 900;
  const itemHeight = receipt.items.reduce((height) => height + 84, 0);
  const height = 900 + itemHeight;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return;

  context.fillStyle = "#f3f6f3";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#ffffff";
  context.fillRect(65, 40, width - 130, height - 80);

  try {
    const logo = await loadImage("/assets/wescomm-logo.png");
    context.drawImage(logo, 285, 75, 330, 115);
  } catch {
    context.fillStyle = "#00652f";
    context.font = "700 42px Arial";
    context.textAlign = "center";
    context.fillText("WESCOMM", width / 2, 130);
  }

  context.textAlign = "center";
  context.fillStyle = "#17211b";
  context.font = "700 24px Arial";
  context.fillText("Wesleyan University-Philippines", width / 2, 215);
  context.font = "18px Arial";
  context.fillStyle = "#5c6860";
  context.fillText("Integrated Commissary Management System", width / 2, 246);
  context.fillText("Cabanatuan City, Nueva Ecija", width / 2, 274);

  context.strokeStyle = "#9eaaa2";
  context.setLineDash([8, 8]);
  context.beginPath();
  context.moveTo(110, 305);
  context.lineTo(790, 305);
  context.stroke();
  context.setLineDash([]);

  context.fillStyle = "#17211b";
  context.font = "700 30px Arial";
  context.fillText("OFFICIAL DIGITAL RECEIPT", width / 2, 350);
  context.font = "700 22px Arial";
  context.fillStyle = "#00652f";
  context.fillText(receipt.code, width / 2, 383);

  context.textAlign = "left";
  context.fillStyle = "#68746d";
  context.font = "18px Arial";
  context.fillText("Student", 120, 430);
  context.fillText("Student Number", 120, 462);
  context.fillText("Transaction Date", 120, 494);
  context.fillText("Payment Method", 120, 526);
  context.textAlign = "right";
  context.fillStyle = "#17211b";
  context.font = "700 18px Arial";
  context.fillText(receipt.student, 780, 430);
  context.fillText(receipt.studentNumber, 780, 462);
  context.fillText(`${receipt.date} - ${receipt.time}`, 780, 494);
  context.fillText(receipt.paymentMethod, 780, 526);

  context.strokeStyle = "#d5ddd6";
  context.beginPath();
  context.moveTo(110, 555);
  context.lineTo(790, 555);
  context.stroke();

  let y = 600;
  context.textAlign = "left";
  context.fillStyle = "#68746d";
  context.font = "700 16px Arial";
  context.fillText("ITEM", 120, y);
  context.textAlign = "center";
  context.fillText("QTY", 590, y);
  context.textAlign = "right";
  context.fillText("AMOUNT", 780, y);
  y += 35;

  receipt.items.forEach((item) => {
    context.textAlign = "left";
    context.fillStyle = "#17211b";
    context.font = "700 19px Arial";
    const lastTextY = drawWrappedText(context, item.name, 120, y, 400, 24);
    context.font = "16px Arial";
    context.fillStyle = "#68746d";
    context.fillText(item.detail, 120, lastTextY + 24);
    context.textAlign = "center";
    context.fillStyle = "#17211b";
    context.font = "18px Arial";
    context.fillText(String(item.quantity), 590, y);
    context.textAlign = "right";
    context.font = "700 18px Arial";
    context.fillText(formatCurrency(item.unitPrice * item.quantity), 780, y);
    y += 84;
  });

  context.strokeStyle = "#d5ddd6";
  context.beginPath();
  context.moveTo(110, y);
  context.lineTo(790, y);
  context.stroke();
  y += 40;

  context.textAlign = "left";
  context.fillStyle = "#68746d";
  context.font = "18px Arial";
  context.fillText("Subtotal", 480, y);
  context.textAlign = "right";
  context.fillStyle = "#17211b";
  context.fillText(formatCurrency(receipt.subtotal), 780, y);
  y += 34;
  context.textAlign = "left";
  context.fillStyle = "#68746d";
  context.fillText("Discount", 480, y);
  context.textAlign = "right";
  context.fillStyle = "#17211b";
  context.fillText(formatCurrency(receipt.discount), 780, y);
  y += 45;

  context.fillStyle = "#edf7ee";
  context.fillRect(455, y - 28, 335, 64);
  context.textAlign = "left";
  context.fillStyle = "#00652f";
  context.font = "700 22px Arial";
  context.fillText("TOTAL", 480, y + 12);
  context.textAlign = "right";
  context.font = "700 27px Arial";
  context.fillText(formatCurrency(receipt.total), 770, y + 12);
  y += 90;

  context.textAlign = "center";
  const statusDisplay = receiptStatusDisplay(receipt.status);
  context.fillStyle = statusDisplay.color;
  context.font = "700 20px Arial";
  context.fillText(statusDisplay.label, width / 2, y);
  context.fillStyle = "#68746d";
  context.font = "16px Arial";
  context.fillText(`Verification reference: ${receipt.transactionReference}`, width / 2, y + 30);
  if (receipt.verifiedBy) {
    context.fillText(`Verified by: ${receipt.verifiedBy}`, width / 2, y + 56);
  }

  const barcodeY = y + 90;
  context.fillStyle = "#17211b";
  let barcodeX = 260;
  Array.from(receipt.transactionReference).forEach((character, index) => {
    const barWidth = ((character.charCodeAt(0) + index) % 4) + 2;
    const barHeight = index % 3 === 0 ? 62 : 50;
    context.fillRect(barcodeX, barcodeY, barWidth, barHeight);
    barcodeX += barWidth + 4;
  });

  context.fillStyle = "#68746d";
  context.font = "15px Arial";
  context.fillText("Keep this receipt for commissary verification and record purposes.", width / 2, barcodeY + 95);
  context.fillText("Thank you for using WESCOMM.", width / 2, barcodeY + 120);

  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `WESCOMM-${receipt.code}.png`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, "image/png");
}

async function downloadReceiptPng(receipt: Receipt) {
  const width = 640;
  const scratch = document.createElement("canvas");
  scratch.width = width;
  scratch.height = 2200;
  const context = scratch.getContext("2d");
  if (!context) return;

  const paperX = 42;
  const paperWidth = width - paperX * 2;
  const contentX = paperX + 44;
  const contentRight = paperX + paperWidth - 44;
  const contentWidth = contentRight - contentX;
  let y = 52;

  context.fillStyle = "#f3f6f3";
  context.fillRect(0, 0, scratch.width, scratch.height);
  context.fillStyle = "#ffffff";
  context.fillRect(paperX, 28, paperWidth, scratch.height - 56);

  try {
    const logo = await loadImage("/assets/wescomm-logo.png");
    const logoWidth = 190;
    const logoHeight = 68;
    context.drawImage(logo, (width - logoWidth) / 2, y, logoWidth, logoHeight);
    y += logoHeight + 18;
  } catch {
    context.fillStyle = "#00652f";
    context.font = "700 32px Arial";
    context.textAlign = "center";
    context.fillText("WESCOMM", width / 2, y + 40);
    y += 68;
  }

  context.textAlign = "center";
  context.fillStyle = "#17211b";
  context.font = "700 18px Arial";
  context.fillText("Wesleyan University-Philippines", width / 2, y);
  y += 25;
  context.font = "15px Arial";
  context.fillStyle = "#5c6860";
  context.fillText("Integrated Commissary Management System", width / 2, y);
  y += 32;

  context.strokeStyle = "#bfc9c1";
  context.lineWidth = 1.5;
  context.setLineDash([7, 7]);
  context.beginPath();
  context.moveTo(contentX, y);
  context.lineTo(contentRight, y);
  context.stroke();
  context.setLineDash([]);
  y += 34;

  context.fillStyle = "#68746d";
  context.font = "700 14px Arial";
  context.fillText("DIGITAL RECEIPT", width / 2, y);
  y += 29;
  context.font = "700 25px Arial";
  context.fillStyle = "#00652f";
  context.fillText(receipt.code, width / 2, y);
  y += 42;

  const details = [
    ["Date", receipt.date],
    ["Time", receipt.time],
    ["Student", receipt.student]
  ];
  details.forEach(([label, value]) => {
    context.textAlign = "left";
    context.fillStyle = "#68746d";
    context.font = "16px Arial";
    context.fillText(label, contentX, y);
    context.textAlign = "right";
    context.fillStyle = "#26322b";
    context.font = "700 16px Arial";
    context.fillText(value, contentRight, y);
    y += 30;
  });

  y += 5;
  context.strokeStyle = "#bfc9c1";
  context.setLineDash([7, 7]);
  context.beginPath();
  context.moveTo(contentX, y);
  context.lineTo(contentRight, y);
  context.stroke();
  context.setLineDash([]);
  y += 34;

  receipt.items.forEach((item) => {
    context.textAlign = "left";
    context.fillStyle = "#26322b";
    context.font = "700 16px Arial";
    const lastTextY = drawWrappedText(
      context,
      `${item.quantity} x ${item.name}`,
      contentX,
      y,
      contentWidth - 155,
      22
    );
    context.textAlign = "right";
    context.fillStyle = "#26322b";
    context.font = "700 16px Arial";
    context.fillText(formatCurrency(item.unitPrice * item.quantity), contentRight, y);
    context.textAlign = "left";
    context.fillStyle = "#77817b";
    context.font = "14px Arial";
    context.fillText(item.detail, contentX, lastTextY + 22);
    y = lastTextY + 55;
  });

  context.strokeStyle = "#bfc9c1";
  context.setLineDash([7, 7]);
  context.beginPath();
  context.moveTo(contentX, y);
  context.lineTo(contentRight, y);
  context.stroke();
  context.setLineDash([]);
  y += 42;

  context.textAlign = "left";
  context.fillStyle = "#26322b";
  context.font = "700 19px Arial";
  context.fillText("TOTAL", contentX, y);
  context.textAlign = "right";
  context.fillStyle = "#00652f";
  context.font = "700 29px Arial";
  context.fillText(formatCurrency(receipt.total), contentRight, y);
  y += 42;

  context.fillStyle = "#f2f7f2";
  context.fillRect(contentX, y, contentWidth, 54);
  context.textAlign = "center";
  const statusDisplay = receiptStatusDisplay(receipt.status);
  context.fillStyle = statusDisplay.color;
  context.font = "700 17px Arial";
  context.fillText(statusDisplay.label, width / 2, y + 34);
  y += 84;

  context.strokeStyle = "#bfc9c1";
  context.setLineDash([7, 7]);
  context.beginPath();
  context.moveTo(contentX, y);
  context.lineTo(contentRight, y);
  context.stroke();
  context.setLineDash([]);
  y += 32;

  context.fillStyle = "#68746d";
  context.font = "700 13px Arial";
  context.fillText("VERIFICATION REFERENCE", width / 2, y);
  y += 25;
  context.fillStyle = "#00652f";
  context.font = "700 16px Arial";
  context.fillText(receipt.transactionReference, width / 2, y);
  y += 24;
  if (receipt.verifiedBy) {
    context.fillStyle = "#68746d";
    context.font = "14px Arial";
    context.fillText(`Verified by: ${receipt.verifiedBy}`, width / 2, y);
    y += 22;
  }

  const barcodeHeight = 58;
  const barcodeGap = 4;
  const barWidths = Array.from(receipt.transactionReference).map(
    (character, index) => ((character.charCodeAt(0) + index) % 3) + 2
  );
  const barcodeWidth =
    barWidths.reduce((total, barWidth) => total + barWidth, 0) +
    Math.max(0, barWidths.length - 1) * barcodeGap;
  let barcodeX = (width - barcodeWidth) / 2;
  const barcodeY = y + 8;
  context.fillStyle = "#17211b";
  barWidths.forEach((barWidth, index) => {
    const barHeight = index % 3 === 0 ? barcodeHeight : 44;
    context.fillRect(barcodeX, barcodeY, barWidth, barHeight);
    barcodeX += barWidth + barcodeGap;
  });
  y = barcodeY + barcodeHeight + 35;

  context.fillStyle = "#68746d";
  context.font = "13px Arial";
  context.fillText("Keep this digital receipt for verification and record purposes.", width / 2, y);
  y += 25;
  context.fillStyle = "#26322b";
  context.font = "700 14px Arial";
  context.fillText("Thank you for using WESCOMM.", width / 2, y);
  y += 34;

  const finalHeight = y + 28;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = finalHeight;
  const finalContext = canvas.getContext("2d");
  if (!finalContext) return;
  finalContext.drawImage(scratch, 0, 0, width, finalHeight, 0, 0, width, finalHeight);

  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `WESCOMM-${receipt.code}.png`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, "image/png");
}

function ReceiptPaper({
  receipt,
  compact = false,
  headingId
}: {
  receipt: Receipt;
  compact?: boolean;
  headingId?: string;
}) {
  return (
    <div className={compact ? "relative bg-white px-5 py-6" : "relative bg-white px-6 py-8 sm:px-9"}>
      <div className="absolute inset-x-0 top-0 h-2 bg-[radial-gradient(circle_at_8px_-2px,transparent_8px,#fff_9px)] bg-[length:16px_10px]" />
      <div className="text-center">
        <Image
          src="/assets/wescomm-logo.png"
          alt="WESCOMM"
          width={compact ? 125 : 165}
          height={65}
          className="mx-auto h-auto object-contain"
        />
        {!compact ? (
          <>
            <p className="mt-2 text-sm font-extrabold text-[#17211b]">Wesleyan University-Philippines</p>
            <p className="text-xs text-[#68746d]">Integrated Commissary Management System</p>
          </>
        ) : null}
        <div className="my-4 border-t border-dashed border-[#bfc9c1]" />
        <p className="text-xs font-bold uppercase text-[#68746d]">Digital Receipt</p>
        <h2 id={headingId} className="mt-1 text-xl font-extrabold text-primary">
          <span className="sr-only">Digital receipt </span>
          {receipt.code}
        </h2>
      </div>

      <dl className="mt-5 grid grid-cols-[1fr_auto] gap-x-5 gap-y-2 text-sm">
        <dt className="text-[#68746d]">Date</dt>
        <dd className="text-right font-semibold">{receipt.date}</dd>
        <dt className="text-[#68746d]">Time</dt>
        <dd className="text-right font-semibold">{receipt.time}</dd>
        <dt className="text-[#68746d]">Student</dt>
        <dd className="text-right font-semibold">{receipt.student}</dd>
      </dl>

      <div className="my-4 border-t border-dashed border-[#bfc9c1]" />
      <div className="space-y-3">
        {receipt.items.slice(0, compact ? 2 : receipt.items.length).map((item) => (
          <div key={`${item.name}-${item.detail}`} className="grid grid-cols-[1fr_auto] gap-3 text-sm">
            <div>
              <p className="font-bold text-[#26322b]">{item.quantity} x {item.name}</p>
              <p className="text-xs text-[#77817b]">{item.detail}</p>
            </div>
            <p className="font-bold">{formatCurrency(item.unitPrice * item.quantity)}</p>
          </div>
        ))}
        {compact && receipt.items.length > 2 ? (
          <p className="text-xs font-semibold text-primary">+ {receipt.items.length - 2} more item</p>
        ) : null}
      </div>

      <div className="my-4 border-t border-dashed border-[#bfc9c1]" />
      <div className="flex items-end justify-between">
        <span className="font-extrabold text-[#26322b]">TOTAL</span>
        <span className="text-2xl font-extrabold text-primary">{formatCurrency(receipt.total)}</span>
      </div>
      <div className="mt-4 flex items-center justify-center gap-2 rounded-md bg-[#f2f7f2] px-3 py-2">
        <ShieldCheck className={receiptStatusDisplay(receipt.status).iconClass} />
        <StatusBadge status={receipt.status} />
      </div>
      <div className="absolute inset-x-0 bottom-0 h-2 rotate-180 bg-[radial-gradient(circle_at_8px_-2px,transparent_8px,#fff_9px)] bg-[length:16px_10px]" />
    </div>
  );
}

function ReceiptModal({
  receipt,
  onClose,
  returnFocusRef
}: {
  receipt: Receipt | null;
  onClose: () => void;
  returnFocusRef: MutableRefObject<HTMLButtonElement | null>;
}) {
  const [mounted, setMounted] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const receiptIdentity = receipt?.id ?? null;

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!receiptIdentity) return;
    const returnFocusElement = returnFocusRef.current;
    const overlay = overlayRef.current;
    const backgroundElements = overlay
      ? Array.from(document.body.children).filter((element): element is HTMLElement => (
          element instanceof HTMLElement && element !== overlay
        ))
      : [];
    const previousBackgroundState = backgroundElements.map((element) => ({
      element,
      inert: element.hasAttribute("inert"),
      ariaHidden: element.getAttribute("aria-hidden")
    }));
    previousBackgroundState.forEach(({ element }) => {
      element.setAttribute("inert", "");
      element.setAttribute("aria-hidden", "true");
    });
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;

      const focusableElements = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => element.getAttribute("aria-hidden") !== "true");
      const firstElement = focusableElements[0];
      const lastElement = focusableElements.at(-1);
      if (!firstElement || !lastElement) {
        event.preventDefault();
        return;
      }

      if (event.shiftKey && (document.activeElement === firstElement || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        lastElement.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === lastElement || !dialog.contains(document.activeElement))
      ) {
        event.preventDefault();
        firstElement.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      previousBackgroundState.forEach(({ element, inert, ariaHidden }) => {
        if (inert) element.setAttribute("inert", "");
        else element.removeAttribute("inert");
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      });
      window.requestAnimationFrame(() => {
        if (returnFocusElement?.isConnected) returnFocusElement.focus();
      });
    };
  }, [receiptIdentity, onClose, returnFocusRef]);

  if (!mounted || !receipt) return null;

  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[9000] grid place-items-center overflow-y-auto bg-[#101820]/55 p-3 backdrop-blur-[2px] sm:p-6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="selected-receipt-title"
        className="relative my-auto w-full max-w-[590px] overflow-hidden rounded-lg bg-[#edf2ed] p-3 shadow-[0_30px_90px_rgba(0,0,0,0.28)] sm:p-6"
      >
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          aria-label={`Close receipt ${receipt.code}`}
          className="absolute right-5 top-5 z-10 grid size-10 place-items-center rounded-md border border-[#d6dfd7] bg-white shadow-sm hover:bg-[#eef6ee]"
        >
          <X className="size-5" />
        </button>
        <div className="max-h-[calc(100svh-155px)] overflow-y-auto shadow-[0_10px_35px_rgba(0,0,0,0.12)]">
          <ReceiptPaper receipt={receipt} headingId="selected-receipt-title" />
          <div className="bg-white px-6 pb-8 sm:px-9">
            <div className="border-t border-dashed border-[#bfc9c1] pt-5 text-center">
              <p className="text-xs font-bold uppercase text-[#68746d]">Verification Reference</p>
              <p className="mt-1 break-all text-sm font-extrabold text-primary">{receipt.transactionReference}</p>
              <div className="mx-auto mt-4 flex h-14 max-w-[280px] items-end justify-center gap-[3px] overflow-hidden">
                {Array.from(receipt.transactionReference).map((character, index) => (
                  <span
                    key={`${character}-${index}`}
                    className="block bg-[#17211b]"
                    style={{
                      width: `${((character.charCodeAt(0) + index) % 3) + 2}px`,
                      height: index % 3 === 0 ? "52px" : "40px"
                    }}
                  />
                ))}
              </div>
              <p className="mt-4 text-xs leading-5 text-[#77817b]">Keep this digital receipt for verification and record purposes.</p>
            </div>
          </div>
        </div>
        <Button className="mt-4 h-12 w-full text-base" onClick={() => downloadReceiptPng(receipt)}>
          <Download className="size-5" />
          Download Receipt as PNG
        </Button>
      </section>
    </div>,
    document.body
  );
}

export function StudentReceiptsExperience() {
  const { user, ready: authReady, openAuth } = useStudentAuth();
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedReceiptId, setSelectedReceiptId] = useState<string | null>(null);
  const receiptTriggerRef = useRef<HTMLButtonElement | null>(null);
  const requestSequenceRef = useRef(0);
  const selectedReceipt = selectedReceiptId
    ? receipts.find((receipt) => receipt.id === selectedReceiptId) ?? null
    : null;
  const closeReceipt = useCallback(() => setSelectedReceiptId(null), []);

  const loadReceipts = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
    if (!authReady) return;
    const requestSequence = ++requestSequenceRef.current;

    if (!user?.accessToken) {
      setReceipts([]);
      setSelectedReceiptId(null);
      setLoading(false);
      return;
    }

    if (!background) {
      setLoading(true);
      setError("");
    }

    try {
      const rows = await getReceiptsFromApi(user.accessToken);
      if (requestSequence !== requestSequenceRef.current) return;
      const nextReceipts = rows.map(mapBackendReceipt);
      setReceipts(nextReceipts);
      setSelectedReceiptId((currentId) => (
        currentId && nextReceipts.some((receipt) => receipt.id === currentId) ? currentId : null
      ));
    } catch (receiptError) {
      if (requestSequence === requestSequenceRef.current && !background) {
        setReceipts([]);
        setSelectedReceiptId(null);
        setError(receiptError instanceof Error ? receiptError.message : "Unable to load receipts.");
      }
    } finally {
      if (requestSequence === requestSequenceRef.current && !background) setLoading(false);
    }
  }, [authReady, user?.accessToken]);

  useEffect(() => {
    void loadReceipts();
    return () => {
      requestSequenceRef.current += 1;
    };
  }, [loadReceipts]);

  useEffect(() => {
    if (!authReady || !user?.accessToken) return;

    const refreshInBackground = () => {
      if (document.visibilityState === "visible") void loadReceipts({ background: true });
    };

    const interval = window.setInterval(refreshInBackground, 15000);
    window.addEventListener("focus", refreshInBackground);
    document.addEventListener("visibilitychange", refreshInBackground);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshInBackground);
      document.removeEventListener("visibilitychange", refreshInBackground);
    };
  }, [authReady, loadReceipts, user?.accessToken]);

  return (
    <>
      <div className="space-y-6">
      <header>
        <p className="text-sm font-bold uppercase text-primary">Digital Receipts</p>
        <h1 className="mt-1 text-3xl font-extrabold text-[#101820] sm:text-4xl">My receipt history</h1>
        <p className="mt-2 text-sm text-[#657169]">View verified transaction details and download official receipt copies.</p>
      </header>

      <section className="rounded-lg border border-[#cfe0d0] bg-[#f3f9f3] p-4">
        <div className="flex items-start gap-3">
          <AssetIcon src="/assets/verified.svg" className="size-8" />
          <div>
            <p className="font-extrabold text-[#203027]">Verifiable digital copies</p>
            <p className="mt-1 text-sm leading-6 text-[#5f6d64]">Each receipt includes a unique transaction reference for commissary verification.</p>
          </div>
        </div>
      </section>

      {!authReady || loading ? (
        <section className="rounded-lg border border-[#dce5dd] bg-white p-6 text-sm font-semibold text-[#68746d] shadow-sm">
          Loading your digital receipts...
        </section>
      ) : !user?.accessToken ? (
        <section className="rounded-lg border border-[#dce5dd] bg-white p-6 shadow-sm">
          <p className="font-extrabold text-[#17211b]">Log in to view your receipts</p>
          <p className="mt-2 max-w-xl text-sm leading-6 text-[#68746d]">
            Use your Wesleyan account to access official receipt copies, verification references, and downloads.
          </p>
          <Button className="mt-5 h-11" onClick={openAuth}>Log in with Wesleyan account</Button>
        </section>
      ) : (
        <>
          {error ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p>
          ) : null}

          {receipts.length ? (
            <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
              {receipts.map((receipt) => (
                <article key={receipt.id} className="overflow-hidden rounded-lg border border-[#dce5dd] bg-[#edf2ed] p-3 shadow-sm">
                  <div className="overflow-hidden shadow-[0_8px_24px_rgba(0,0,0,0.09)]">
                    <ReceiptPaper receipt={receipt} compact />
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Button
                      variant="secondary"
                      className="h-11"
                      aria-label={`View receipt ${receipt.code}`}
                      onClick={(event) => {
                        receiptTriggerRef.current = event.currentTarget;
                        // Avoid leaving focus inside content that becomes aria-hidden
                        // before the dialog takes focus on the next animation frame.
                        event.currentTarget.blur();
                        setSelectedReceiptId(receipt.id);
                      }}
                    >
                      <Eye className="size-4" />
                      View Receipt
                    </Button>
                    <Button
                      className="h-11"
                      aria-label={`Download receipt ${receipt.code} as PNG`}
                      onClick={() => downloadReceiptPng(receipt)}
                    >
                      <Download className="size-4" />
                      PNG
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <section className="rounded-lg border border-[#dce5dd] bg-white p-6 shadow-sm">
              <p className="font-extrabold text-[#17211b]">No receipts yet</p>
              <p className="mt-2 max-w-xl text-sm leading-6 text-[#68746d]">
                Completed reservations will appear here after staff generates or verifies the digital receipt.
              </p>
            </section>
          )}
        </>
      )}

      </div>
      <ReceiptModal receipt={selectedReceipt} onClose={closeReceipt} returnFocusRef={receiptTriggerRef} />
    </>
  );
}
