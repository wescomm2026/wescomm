import QRCode from "qrcode";
import type { WalkInCollectionChannel, WalkInReceipt } from "@/lib/staff-api";

/**
 * Thermal receipts are printed through the browser's normal print dialog so any
 * installed thermal printer driver works. The browser cannot detect the paper
 * width, so each computer remembers its own setting.
 *
 * Paper width and printable width differ: a 58 mm roll prints roughly 48 mm
 * (384 dots at 203 dpi) and an 80 mm roll roughly 72 mm (576 dots). The receipt
 * is laid out at the printable width and centered on the page so nothing is
 * clipped by the printer's unprintable side margins.
 *
 * Page length: when the page size requested by the receipt differs from the paper
 * size selected in the printer driver, Chrome scales and centers the page on the
 * driver's paper, which feeds blank paper before the receipt. "PRINTER" (default)
 * requests no page size so the receipt starts at the top edge; "CUSTOM" matches a
 * known driver paper length; "FIT" makes the page exactly as long as the receipt.
 */
export type ThermalPaperPreset = "58" | "80" | "CUSTOM";
export type ThermalPageLength = "PRINTER" | "CUSTOM" | "FIT";

export type ThermalPrinterSettings = {
  preset: ThermalPaperPreset;
  paperWidthMm: number;
  printableWidthMm: number;
  pageLength: ThermalPageLength;
  /** Used when pageLength is CUSTOM. */
  pageLengthMm: number;
};

export const THERMAL_PAPER_PRESETS = {
  "58": { paperWidthMm: 58, printableWidthMm: 48 },
  "80": { paperWidthMm: 80, printableWidthMm: 72 }
} as const;

export const THERMAL_CUSTOM_PAPER_WIDTH = { min: 40, max: 110 } as const;
export const THERMAL_MIN_PRINTABLE_WIDTH = 30;
export const THERMAL_CUSTOM_PAGE_LENGTH = { min: 50, max: 3300 } as const;
export const DEFAULT_THERMAL_PAGE_LENGTH_MM = 297;

// 58 mm is the safe default: a narrow layout still prints on an 80 mm printer,
// while an 80 mm layout would be clipped on a 58 mm printer.
export const DEFAULT_THERMAL_PRINTER_SETTINGS: ThermalPrinterSettings = {
  preset: "58",
  ...THERMAL_PAPER_PRESETS["58"],
  pageLength: "PRINTER",
  pageLengthMm: DEFAULT_THERMAL_PAGE_LENGTH_MM
};

const SETTINGS_STORAGE_KEY = "wescomm.thermal-printer.v1";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function roundToHalf(value: number) {
  return Math.round(value * 2) / 2;
}

export function defaultPrintableWidthMm(paperWidthMm: number) {
  return Math.max(THERMAL_MIN_PRINTABLE_WIDTH, Math.round(paperWidthMm - (paperWidthMm >= 70 ? 8 : 10)));
}

function normalizePageLength(candidate: Partial<Record<keyof ThermalPrinterSettings, unknown>>) {
  const pageLength: ThermalPageLength = candidate.pageLength === "CUSTOM" || candidate.pageLength === "FIT" ? candidate.pageLength : "PRINTER";
  const requestedLength = Number(candidate.pageLengthMm);
  const pageLengthMm = Number.isFinite(requestedLength) && requestedLength > 0
    ? Math.round(clamp(requestedLength, THERMAL_CUSTOM_PAGE_LENGTH.min, THERMAL_CUSTOM_PAGE_LENGTH.max))
    : DEFAULT_THERMAL_PAGE_LENGTH_MM;
  return { pageLength, pageLengthMm };
}

export function normalizeThermalPrinterSettings(value: unknown): ThermalPrinterSettings {
  const candidate = (value && typeof value === "object" ? value : {}) as Partial<Record<keyof ThermalPrinterSettings, unknown>>;
  return { ...normalizePaperWidth(candidate), ...normalizePageLength(candidate) };
}

function normalizePaperWidth(
  candidate: Partial<Record<keyof ThermalPrinterSettings, unknown>>
): Pick<ThermalPrinterSettings, "preset" | "paperWidthMm" | "printableWidthMm"> {
  if (candidate.preset === "58" || candidate.preset === "80") {
    return { preset: candidate.preset, ...THERMAL_PAPER_PRESETS[candidate.preset] };
  }
  if (candidate.preset !== "CUSTOM") {
    return { preset: "58" as const, ...THERMAL_PAPER_PRESETS["58"] };
  }

  const requestedPaper = Number(candidate.paperWidthMm);
  const paperWidthMm = Number.isFinite(requestedPaper)
    ? roundToHalf(clamp(requestedPaper, THERMAL_CUSTOM_PAPER_WIDTH.min, THERMAL_CUSTOM_PAPER_WIDTH.max))
    : DEFAULT_THERMAL_PRINTER_SETTINGS.paperWidthMm;
  const requestedPrintable = Number(candidate.printableWidthMm);
  const printableWidthMm = Number.isFinite(requestedPrintable)
    ? roundToHalf(clamp(requestedPrintable, THERMAL_MIN_PRINTABLE_WIDTH, paperWidthMm))
    : defaultPrintableWidthMm(paperWidthMm);
  return { preset: "CUSTOM" as const, paperWidthMm, printableWidthMm };
}

export function loadThermalPrinterSettings(): ThermalPrinterSettings {
  try {
    const stored = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    return stored ? normalizeThermalPrinterSettings(JSON.parse(stored)) : DEFAULT_THERMAL_PRINTER_SETTINGS;
  } catch {
    return DEFAULT_THERMAL_PRINTER_SETTINGS;
  }
}

export function saveThermalPrinterSettings(settings: ThermalPrinterSettings) {
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(normalizeThermalPrinterSettings(settings)));
    return true;
  } catch {
    return false;
  }
}

export function hasSavedThermalPrinterSettings() {
  try {
    return Boolean(window.localStorage.getItem(SETTINGS_STORAGE_KEY));
  } catch {
    return false;
  }
}

export type ThermalReceiptData = {
  receiptCode: string;
  issuedAt: string;
  buyerName: string;
  studentNumber: string | null;
  cashierName: string | null;
  collectionChannel: WalkInCollectionChannel;
  officialReceiptNumber: string | null;
  items: Array<{
    productName: string;
    options: Array<{ optionName: string; optionValue: string }>;
    quantity: number;
    unitPrice: string;
    subtotal: string;
  }>;
  totalAmount: string;
  cashTendered: string | null;
  changeDue: string | null;
  status: WalkInReceipt["status"];
  voidedAt: string | null;
  voidReason: string | null;
  treasuryReconciliationRequired: boolean;
  verificationUrl: string | null;
};

export function thermalReceiptFromWalkIn(receipt: WalkInReceipt): ThermalReceiptData {
  return {
    receiptCode: receipt.receiptCode,
    issuedAt: receipt.issuedAt,
    buyerName: receipt.buyerName,
    studentNumber: receipt.student?.studentNumber ?? null,
    cashierName: receipt.sale?.cashierName ?? receipt.issuedBy?.fullName ?? null,
    collectionChannel: receipt.collectionChannel ?? "COMMISSARY",
    officialReceiptNumber: receipt.officialReceiptNumber ?? null,
    items: receipt.items.map((item) => ({
      productName: item.productName,
      options: item.options,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      subtotal: item.subtotal
    })),
    totalAmount: receipt.totalAmount,
    cashTendered: receipt.sale?.cashTendered ?? null,
    changeDue: receipt.sale?.changeDue ?? null,
    status: receipt.status,
    voidedAt: receipt.voidedAt ?? receipt.sale?.voidedAt ?? null,
    voidReason: receipt.sale?.voidReason ?? null,
    treasuryReconciliationRequired: Boolean(receipt.treasuryReconciliationRequired),
    verificationUrl: receipt.publicVerificationUrl ?? null
  };
}

export function sampleThermalReceipt(origin: string): ThermalReceiptData {
  return {
    receiptCode: "RCT-TEST-PRINTER",
    issuedAt: new Date().toISOString(),
    buyerName: "Printer Test Buyer With A Long Name",
    studentNumber: null,
    cashierName: "Commissary Cashier",
    collectionChannel: "COMMISSARY",
    officialReceiptNumber: null,
    items: [
      {
        productName: "Long product name test: PE uniform set with polo shirt, jogging pants, and embroidered logo",
        options: [{ optionName: "Size", optionValue: "XL" }, { optionName: "Color", optionValue: "Maroon" }],
        quantity: 2,
        unitPrice: "1250.00",
        subtotal: "2500.00"
      },
      { productName: "ID lace", options: [], quantity: 1, unitPrice: "45.00", subtotal: "45.00" },
      { productName: "Notebook", options: [{ optionName: "Type", optionValue: "Spiral" }], quantity: 12, unitPrice: "38.50", subtotal: "462.00" }
    ],
    totalAmount: "3007.00",
    cashTendered: "5000.00",
    changeDue: "1993.00",
    status: "VERIFIED",
    voidedAt: null,
    voidReason: null,
    treasuryReconciliationRequired: false,
    verificationUrl: `${origin}/verify-receipt`
  };
}

export type ThermalReceiptCopy = "ORIGINAL" | "REPRINT" | "TEST";

export type ThermalReceiptOptions = {
  settings: ThermalPrinterSettings;
  copy: ThermalReceiptCopy;
  /** Absolute URL of the monochrome logo; the print document has no base URL. */
  logoUrl: string;
  printedAt?: Date;
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function money(value: string | number | null) {
  const amount = Number(value ?? 0);
  return `PHP ${(Number.isFinite(amount) ? amount : 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function manilaDateTime(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function row(label: string, value: string, className = "") {
  return `<div class="row ${className}"><span class="label">${escapeHtml(label)}</span> <span class="value">${escapeHtml(value)}</span></div>`;
}

function baseFontPt(printableWidthMm: number) {
  if (printableWidthMm < 44) return 7.5;
  if (printableWidthMm < 56) return 8.5;
  if (printableWidthMm < 68) return 9.5;
  return 10.5;
}

export async function buildThermalReceiptDocument(data: ThermalReceiptData, options: ThermalReceiptOptions) {
  const { settings, copy } = options;
  const printable = settings.printableWidthMm;
  const qrSizeMm = Math.round(clamp(printable * 0.55, 20, 36));
  const logoWidthMm = Math.round(clamp(printable * 0.62, 26, 46));
  const voided = data.status === "VOIDED";
  const treasury = data.collectionChannel === "TREASURER";

  const qrSvg = data.verificationUrl
    ? await QRCode.toString(data.verificationUrl, { type: "svg", margin: 0, errorCorrectionLevel: "M" })
    : "";

  const flags: string[] = [];
  if (copy === "TEST") {
    flags.push(`<div class="flag">TEST RECEIPT<br><span class="small">Not a sale. Check that both edge marks print.</span></div>`);
  }
  if (voided) {
    flags.push(`<div class="flag void">VOIDED</div>`);
  }
  if (copy === "REPRINT") {
    flags.push(`<div class="flag">REPRINT<br><span class="small">Printed ${escapeHtml(manilaDateTime(options.printedAt ?? new Date()))}</span></div>`);
  }

  const items = data.items.map((item) => {
    const optionText = item.options.map((option) => `${option.optionName}: ${option.optionValue}`).join(" / ");
    return `<div class="item">
      <div class="item-name">${escapeHtml(item.productName)}</div>
      ${optionText ? `<div class="item-options">${escapeHtml(optionText)}</div>` : ""}
      <div class="row"><span class="label">${item.quantity} x ${escapeHtml(money(item.unitPrice))}</span> <span class="value strong">${escapeHtml(money(item.subtotal))}</span></div>
    </div>`;
  }).join("");

  const payment = treasury
    ? [
        row("Paid at", "Treasury"),
        `<div class="or-number"><span class="small">Treasury OR No.</span> <span class="code">${escapeHtml(data.officialReceiptNumber ?? "Missing")}</span></div>`
      ].join("")
    : [
        row("Paid at", "Commissary (cash)"),
        row("Cash received", money(data.cashTendered)),
        row("Change", money(data.changeDue), "strong")
      ].join("");

  const voidDetails = voided
    ? `<div class="rule"></div>
      ${data.voidedAt ? row("Voided", manilaDateTime(data.voidedAt)) : ""}
      ${data.voidReason ? `<div class="note">Reason: ${escapeHtml(data.voidReason)}</div>` : ""}
      ${data.treasuryReconciliationRequired ? `<div class="note strong">Treasury refund or reconciliation required.</div>` : ""}`
    : "";

  const calibration = copy === "TEST"
    ? `<div class="calibration"><span>|&lt;</span> <span>${escapeHtml(String(printable))} mm printable on ${escapeHtml(String(settings.paperWidthMm))} mm paper</span> <span>&gt;|</span></div>`
    : "";

  const itemCount = data.items.reduce((total, item) => total + item.quantity, 0);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(data.receiptCode)}</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: white; color: black; }
  body { width: ${settings.paperWidthMm}mm; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .receipt {
    width: ${printable}mm;
    margin: 0 auto;
    padding: 2mm 0 6mm;
    font-family: Arial, "Helvetica Neue", Helvetica, sans-serif;
    font-size: ${baseFontPt(printable)}pt;
    line-height: 1.25;
    color: black;
  }
  .center { text-align: center; }
  .logo { display: block; width: ${logoWidthMm}mm; max-width: 100%; height: auto; margin: 0 auto 1mm; }
  .brand { margin: 0; font-size: 1.35em; font-weight: 800; letter-spacing: 0.08em; }
  .title { margin-top: 0.5mm; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; }
  .code { margin-top: 1mm; font-family: Consolas, "Courier New", monospace; font-weight: 700; font-size: 1.05em; overflow-wrap: anywhere; }
  .flag { margin: 2mm 0; padding: 1mm; border: 0.5mm solid black; text-align: center; font-weight: 800; letter-spacing: 0.06em; }
  .flag.void { font-size: 1.7em; letter-spacing: 0.25em; border-width: 0.8mm; }
  .small { font-size: 0.85em; font-weight: 400; letter-spacing: 0; }
  .rule { margin: 1.6mm 0; border-top: 0.3mm dashed black; }
  .row { display: flex; justify-content: space-between; align-items: baseline; gap: 2mm; }
  .row .label { flex: 0 0 auto; }
  .row .value { flex: 1 1 auto; min-width: 0; text-align: right; overflow-wrap: anywhere; }
  .strong, .row.strong .value, .row.strong .label { font-weight: 800; }
  .item { margin: 1.2mm 0; break-inside: avoid; }
  .item-name { font-weight: 700; overflow-wrap: anywhere; }
  .item-options { font-size: 0.9em; overflow-wrap: anywhere; }
  .total { font-size: 1.3em; font-weight: 800; }
  .or-number { margin-top: 1mm; padding: 1mm; border: 0.3mm solid black; text-align: center; }
  .or-number .small, .or-number .code { display: block; margin: 0; }
  .note { margin-top: 1mm; overflow-wrap: anywhere; }
  .qr { margin-top: 2mm; text-align: center; break-inside: avoid; }
  .qr svg { display: block; width: ${qrSizeMm}mm; height: ${qrSizeMm}mm; margin: 0 auto 1mm; }
  .calibration { display: flex; justify-content: space-between; margin: 2mm 0; padding: 1mm 0; border-left: 0.6mm solid black; border-right: 0.6mm solid black; font-size: 0.85em; font-weight: 700; }
  .footer { margin-top: 2mm; text-align: center; font-size: 0.9em; }
</style>
</head>
<body>
<main class="receipt">
  <div class="center">
    <img class="logo" src="${escapeHtml(options.logoUrl)}" alt="">
    <p class="brand">COMMISSARY</p>
    <div class="title">Sales Receipt</div>
    <div class="code">${escapeHtml(data.receiptCode)}</div>
  </div>
  ${flags.join("")}
  ${calibration}
  <div class="rule"></div>
  ${row("Date", manilaDateTime(data.issuedAt))}
  ${row("Buyer", data.buyerName)}
  ${data.studentNumber ? row("Student No.", data.studentNumber) : ""}
  ${data.cashierName ? row("Cashier", data.cashierName) : ""}
  ${row("Collected at", treasury ? "Treasury" : "Commissary")}
  <div class="rule"></div>
  ${items}
  <div class="rule"></div>
  ${row(`Items (${itemCount})`, money(data.totalAmount))}
  <div class="row total"><span class="label">TOTAL</span> <span class="value">${escapeHtml(money(data.totalAmount))}</span></div>
  <div class="rule"></div>
  ${payment}
  ${voidDetails}
  ${qrSvg ? `<div class="qr">${qrSvg}<div class="small">Scan to verify this receipt</div></div>` : ""}
  <div class="footer">Thank you!</div>
</main>
</body>
</html>`;
}

const MM_PER_CSS_PIXEL = 25.4 / 96;

/** The @page rule for the chosen page length; measuredHeightMm is the receipt's own length. */
export function thermalPageRule(settings: ThermalPrinterSettings, measuredHeightMm: number) {
  if (settings.pageLength === "PRINTER") return "@page { margin: 0; }";
  const lengthMm = settings.pageLength === "CUSTOM" ? settings.pageLengthMm : measuredHeightMm;
  return `@page { size: ${settings.paperWidthMm}mm ${lengthMm}mm; margin: 0; }`;
}

/**
 * Prints the receipt document from an off-screen iframe so the print preview
 * contains only the receipt. The page size follows the saved page-length setting
 * (see ThermalPageLength); for FIT the height is measured after layout.
 */
export async function printThermalDocument(html: string, settings: ThermalPrinterSettings) {
  const iframe = document.createElement("iframe");
  iframe.title = "Receipt print view";
  iframe.setAttribute("aria-hidden", "true");
  iframe.tabIndex = -1;
  Object.assign(iframe.style, {
    position: "fixed",
    left: "-10000px",
    top: "0",
    width: `${settings.paperWidthMm}mm`,
    height: "10px",
    border: "0"
  });

  const loaded = new Promise<void>((resolve) => iframe.addEventListener("load", () => resolve(), { once: true }));
  iframe.srcdoc = html;
  document.body.appendChild(iframe);
  await loaded;

  const frameDocument = iframe.contentDocument;
  const frameWindow = iframe.contentWindow;
  if (!frameDocument || !frameWindow) {
    iframe.remove();
    throw new Error("The receipt print view could not be opened.");
  }

  await Promise.all(Array.from(frameDocument.images).map((image) => image.decode().catch(() => undefined)));
  await frameDocument.fonts?.ready;

  const receiptElement = frameDocument.querySelector(".receipt");
  const heightPx = receiptElement?.getBoundingClientRect().height ?? frameDocument.documentElement.scrollHeight;
  const pageHeightMm = Math.ceil(heightPx * MM_PER_CSS_PIXEL) + 2;
  const pageStyle = frameDocument.createElement("style");
  pageStyle.textContent = thermalPageRule(settings, pageHeightMm);
  frameDocument.head.appendChild(pageStyle);

  let removed = false;
  const cleanup = () => {
    if (removed) return;
    removed = true;
    iframe.remove();
  };
  frameWindow.addEventListener("afterprint", () => window.setTimeout(cleanup, 0), { once: true });
  // Safety net for browsers that never fire afterprint.
  window.setTimeout(cleanup, 5 * 60 * 1000);
  frameWindow.focus();
  frameWindow.print();
}

export async function printThermalReceipt(data: ThermalReceiptData, options: Omit<ThermalReceiptOptions, "logoUrl"> & { logoUrl?: string }) {
  const html = await buildThermalReceiptDocument(data, {
    ...options,
    logoUrl: options.logoUrl ?? thermalReceiptLogoUrl()
  });
  await printThermalDocument(html, options.settings);
}

export function thermalReceiptLogoUrl() {
  return `${window.location.origin}/assets/wescomm-logo-receipt.png`;
}
