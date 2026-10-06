"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Download, Printer, X } from "lucide-react";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import { Button } from "@/components/ui/button";
import { AssetIcon } from "@/components/ui/AssetIcon";
import { InlineAlert } from "@/components/ui/InlineAlert";
import {
  downloadSalesLedgerFromApi,
  getSalesLedgerFromApi,
  isRequestAbortError,
  recordSalesLedgerPrintAuditFromApi,
  type BackendSalesLedger,
  type SalesLedgerChannel,
  type SalesLedgerLocation,
  type SalesLedgerOptions,
  type SalesLedgerPeriod
} from "@/lib/api";
import { getStoredStaffSession } from "@/lib/staff-api";
import { manilaDateKey } from "@/lib/manila-date";
import { userFacingErrorMessage } from "@/lib/user-facing-error";

type SalesReportPreviewProps = {
  role: "STAFF" | "ADMIN";
  onClose: () => void;
  onOptionsChange?: (options: SalesLedgerOptions) => void;
};

export function defaultSalesLedgerOptions(): SalesLedgerOptions {
  return {
    period: "DAILY",
    anchor: manilaDateKey(new Date()) ?? "",
    channel: "ALL",
    collectionLocation: "ALL"
  };
}

const PERIOD_TITLES: Record<SalesLedgerPeriod, string> = {
  DAILY: "Daily Sales Report",
  WEEKLY: "Weekly Sales Report",
  MONTHLY: "Monthly Sales Report"
};

const CHANNEL_LABELS: Record<SalesLedgerChannel, string> = {
  ALL: "All channels",
  RESERVATION: "Reservations only",
  WALK_IN: "Walk-in only"
};

const LOCATION_LABELS: Record<SalesLedgerLocation, string> = {
  ALL: "All locations",
  COMMISSARY: "Commissary",
  TREASURER: "Treasury"
};

const REGISTER_COLUMNS: Array<{ label: string; width: string; numeric?: boolean }> = [
  { label: "#", width: "3%", numeric: true },
  { label: "Date/Time", width: "10%" },
  { label: "Receipt No.", width: "9.5%" },
  { label: "Type", width: "6%" },
  { label: "Student/Buyer", width: "11%" },
  { label: "Order Ref.", width: "8%" },
  { label: "Items", width: "19.5%" },
  { label: "Qty", width: "4%", numeric: true },
  { label: "Collection Point", width: "8%" },
  // Wide enough for a typical full name on one line, so register rows stay one line tall.
  { label: "Cashier", width: "13%" },
  { label: "Amount", width: "8%", numeric: true }
];

// A4 landscape (210 mm tall) minus the 8 mm top and 12 mm bottom @page margins in
// globals.css, less a small buffer for rounding between screen and print layout.
const PRINT_PAGE_HEIGHT_MM = 210 - 8 - 12 - 3;
const MM_PER_CSS_PIXEL = 25.4 / 96;
// Shrink to one page only when the report barely overflows it; longer reports
// paginate at full size rather than becoming unreadably small.
const MIN_FIT_SCALE = 0.8;
// A void list this short prints together with the sign-off block.
const COMPACT_CLOSING_MAX_VOIDS = 10;

export function salesReportPrintScale(contentHeightMm: number) {
  if (!Number.isFinite(contentHeightMm) || contentHeightMm <= PRINT_PAGE_HEIGHT_MM) return 1;
  const scale = Math.floor((PRINT_PAGE_HEIGHT_MM / contentHeightMm) * 100) / 100;
  return scale >= MIN_FIT_SCALE ? scale : 1;
}

function transactionCount(count: number) {
  return `${count.toLocaleString("en-PH")} transaction${count === 1 ? "" : "s"}`;
}

function ReportFigure({ label, value, detail, tone }: { label: string; value: string; detail?: string; tone?: "total" | "void" }) {
  return (
    <div className={tone === "total" ? "srd-figure srd-figure--total" : tone === "void" ? "srd-figure srd-figure--void" : "srd-figure"}>
      <dt>{label}</dt>
      <dd>
        <span className="srd-figure-value">{value}</span>
        {detail ? <span className="srd-figure-detail">{detail}</span> : null}
      </dd>
    </div>
  );
}

function formatPeso(value: number) {
  return `\u20b1${value.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-PH", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Manila"
  });
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    timeZone: "Asia/Manila"
  });
}

function resolveToken(user: ReturnType<typeof useStudentAuth>["user"]) {
  const storedSession = getStoredStaffSession();
  const userCanUseStaffApi = user?.role === "STAFF" || user?.role === "ADMIN";
  return userCanUseStaffApi ? user.accessToken ?? "" : !user ? storedSession.token : "";
}

export function SalesReportPreview({ role, onClose, onOptionsChange }: SalesReportPreviewProps) {
  const { user } = useStudentAuth();
  const [period, setPeriod] = useState<SalesLedgerPeriod>("DAILY");
  const [anchor, setAnchor] = useState(() => manilaDateKey(new Date()) ?? "");
  const [channel, setChannel] = useState<SalesLedgerChannel>("ALL");
  const [collectionLocation, setCollectionLocation] = useState<SalesLedgerLocation>("ALL");
  const [report, setReport] = useState<BackendSalesLedger | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const requestAbortRef = useRef<AbortController | null>(null);
  const requestSequenceRef = useRef(0);
  const printAreaRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    return () => requestAbortRef.current?.abort();
  }, []);

  // Browsers fire beforeprint for both the Print button and Ctrl+P. Switch the report to
  // its print layout, measure it at the printed width, and fit it to one page if needed.
  useEffect(() => {
    if (!report) return;
    const applyPrintLayout = () => {
      const printArea = printAreaRef.current;
      if (!printArea) return;
      printArea.style.removeProperty("--srd-print-scale");
      printArea.classList.add("srd-print-layout");
      const heightMm = printArea.getBoundingClientRect().height * MM_PER_CSS_PIXEL;
      const scale = salesReportPrintScale(heightMm);
      if (scale < 1) printArea.style.setProperty("--srd-print-scale", String(scale));
    };
    const restoreScreenLayout = () => {
      const printArea = printAreaRef.current;
      if (!printArea) return;
      printArea.classList.remove("srd-print-layout");
      printArea.style.removeProperty("--srd-print-scale");
    };
    window.addEventListener("beforeprint", applyPrintLayout);
    window.addEventListener("afterprint", restoreScreenLayout);
    return () => {
      window.removeEventListener("beforeprint", applyPrintLayout);
      window.removeEventListener("afterprint", restoreScreenLayout);
      restoreScreenLayout();
    };
  }, [report]);

  const options = useMemo<SalesLedgerOptions>(() => ({
    period,
    anchor,
    channel,
    collectionLocation
  }), [period, anchor, channel, collectionLocation]);

  useEffect(() => {
    onOptionsChange?.(options);
  }, [options, onOptionsChange]);

  const previewReport = useCallback(async () => {
    const token = resolveToken(user);
    if (!token || !anchor) {
      setError("A staff or admin session is required to preview the sales report.");
      return;
    }

    const requestId = ++requestSequenceRef.current;
    requestAbortRef.current?.abort();
    const requestController = new AbortController();
    requestAbortRef.current = requestController;
    setLoading(true);
    setError("");

    try {
      const data = await getSalesLedgerFromApi(token, { period, anchor, channel, collectionLocation }, role, requestController.signal);
      if (requestId === requestSequenceRef.current) setReport(data);
    } catch (loadError) {
      if (requestId === requestSequenceRef.current && !isRequestAbortError(loadError)) {
        setError(userFacingErrorMessage(loadError, "Unable to load the sales report."));
      }
    } finally {
      if (requestId === requestSequenceRef.current) setLoading(false);
    }
  }, [anchor, channel, collectionLocation, period, role, user]);

  const printReport = useCallback(async () => {
    if (!report) return;
    const token = resolveToken(user);
    if (token) {
      try {
        await recordSalesLedgerPrintAuditFromApi(token, { ...options, snapshotAt: report.generatedAt }, role);
      } catch {
        // Printing must not be blocked by audit logging.
      }
    }
    window.print();
  }, [options, report, role, user]);

  const downloadExcel = useCallback(async () => {
    const token = resolveToken(user);
    if (!token || !anchor) {
      setError("A staff or admin session is required to download the sales report.");
      return;
    }
    setDownloading(true);
    setError("");
    try {
      const { blob, fileName } = await downloadSalesLedgerFromApi(
        token,
        { period, anchor, channel, collectionLocation, snapshotAt: report?.generatedAt },
        role
      );
      const url = URL.createObjectURL(blob);
      const downloadAnchor = document.createElement("a");
      downloadAnchor.href = url;
      downloadAnchor.download = fileName;
      downloadAnchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (downloadError) {
      setError(userFacingErrorMessage(downloadError, "Unable to download the sales report."));
    } finally {
      setDownloading(false);
    }
  }, [anchor, channel, collectionLocation, period, report?.generatedAt, role, user]);

  const summary = report?.summary ?? null;
  const productTotals = useMemo(() => (report?.productSummary ?? []).reduce(
    (sum, row) => ({ quantity: sum.quantity + row.quantity, sales: sum.sales + row.sales, cogs: sum.cogs + row.cogs, grossProfit: sum.grossProfit + row.grossProfit }),
    { quantity: 0, sales: 0, cogs: 0, grossProfit: 0 }
  ), [report]);

  return (
    <section className="rounded-xl border bg-card shadow-soft">
      <div className="border-b border-border px-5 py-4 no-print">
        <div>
          <h2 className="font-extrabold text-foreground">Sales register</h2>
          <p className="mt-1 text-xs text-muted-foreground">Transaction-level printable report for a specific day, calendar week (Monday–Sunday), or month.</p>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-[repeat(4,minmax(0,1fr))_auto] xl:items-end">
          <label className="grid gap-1.5 text-sm font-bold">
            Report type
            <select
              value={period}
              onChange={(event) => setPeriod(event.target.value as SalesLedgerPeriod)}
              className="h-11 rounded-md border bg-white px-3 outline-none focus:border-primary"
            >
              <option value="DAILY">Daily</option>
              <option value="WEEKLY">Weekly (Mon–Sun)</option>
              <option value="MONTHLY">Monthly</option>
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-bold">
            {period === "DAILY" ? "Date" : period === "WEEKLY" ? "Any day in the week" : "Any day in the month"}
            <input
              type="date"
              value={anchor}
              max={manilaDateKey(new Date()) ?? undefined}
              onChange={(event) => setAnchor(event.target.value)}
              className="h-11 rounded-md border bg-white px-3 outline-none focus:border-primary"
            />
          </label>
          <label className="grid gap-1.5 text-sm font-bold">
            Sales channel
            <select
              value={channel}
              onChange={(event) => setChannel(event.target.value as SalesLedgerChannel)}
              className="h-11 rounded-md border bg-white px-3 outline-none focus:border-primary"
            >
              <option value="ALL">All</option>
              <option value="RESERVATION">Reservation</option>
              <option value="WALK_IN">Walk-in</option>
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-bold">
            Collection location
            <select
              value={collectionLocation}
              onChange={(event) => setCollectionLocation(event.target.value as SalesLedgerLocation)}
              className="h-11 rounded-md border bg-white px-3 outline-none focus:border-primary"
            >
              <option value="ALL">All</option>
              <option value="COMMISSARY">Commissary</option>
              <option value="TREASURER">Treasury</option>
            </select>
          </label>
          <Button className="h-11" onClick={() => void previewReport()} disabled={loading || !anchor}>
            <CalendarDays className="size-4" />
            Preview Report
          </Button>
        </div>
      </div>

      {error ? <InlineAlert className="no-print mx-5 mt-4" onDismiss={() => setError("")}>{error}</InlineAlert> : null}
      {loading ? <div className="no-print p-6 text-sm font-semibold text-muted-foreground">Loading sales report data...</div> : null}

      {report && summary ? (
        <div className="p-5">
          {!report.sales.length ? (
            <InlineAlert tone="warning" className="no-print mb-4" title={`No valid sales were recorded for ${report.range.label}.`}>
              You may still print or download this zero-activity report for the official record.
            </InlineAlert>
          ) : null}
          <article ref={printAreaRef} id="sales-report-print-area" data-print-document className="sales-report-doc" aria-label={`${PERIOD_TITLES[report.range.period]} for ${report.range.label}`}>
            <header className="srd-header">
              <div>
                <p className="srd-wordmark">WESCOMM</p>
                <p className="srd-title">{PERIOD_TITLES[report.range.period]}</p>
                <p className="srd-org">Wesleyan University-Philippines — Integrated Commissary Management System</p>
                <p className="srd-period">Reporting period: {report.range.label}</p>
              </div>
              <dl className="srd-meta">
                {([
                  ["Generated", formatDateTime(report.generatedAt)],
                  ["Generated by", report.generatedBy ?? "Not recorded"],
                  ["Channel", CHANNEL_LABELS[report.filters.channel]],
                  ["Collection location", LOCATION_LABELS[report.filters.collectionLocation]],
                  ["Timezone", "Asia/Manila"]
                ] as const).map(([label, value]) => (
                  <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
                ))}
              </dl>
            </header>

            <section className="srd-section" aria-labelledby="srd-summary-heading">
              <h3 id="srd-summary-heading" className="srd-heading">Summary</h3>
              <dl className="srd-figures">
                <ReportFigure label="Transactions" value={summary.validSalesTransactions.toLocaleString("en-PH")} />
                <ReportFigure label="Units sold" value={summary.totalUnitsSold.toLocaleString("en-PH")} />
                <ReportFigure label="Reservation sales" value={formatPeso(summary.reservationSales.amount)} detail={transactionCount(summary.reservationSales.count)} />
                <ReportFigure label="Walk-in sales" value={formatPeso(summary.walkInSales.amount)} detail={transactionCount(summary.walkInSales.count)} />
                <ReportFigure label="Total recognized sales" value={formatPeso(summary.totalRecognizedSales)} tone="total" />
                <ReportFigure label="Voids processed" value={summary.voidsProcessed.count.toLocaleString("en-PH")} detail="Listed under Voided Transactions" />
                <ReportFigure label="Void amount" value={formatPeso(summary.voidsProcessed.amount)} detail="Excluded from recognized sales" tone="void" />
              </dl>
            </section>

            <section className="srd-section" aria-labelledby="srd-register-heading">
              <h3 id="srd-register-heading" className="srd-heading">Main Sales Register</h3>
              {report.sales.length ? (
                <div className="srd-table-wrap">
                  <table className="srd-table srd-table--register">
                    <colgroup>
                      {REGISTER_COLUMNS.map((column) => <col key={column.label} style={{ width: column.width }} />)}
                    </colgroup>
                    <thead>
                      <tr>
                        {REGISTER_COLUMNS.map((column) => <th key={column.label} scope="col" className={column.numeric ? "num" : undefined}>{column.label}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {report.sales.map((sale) => (
                        <tr key={`${sale.receiptCode}-${sale.sequence}`}>
                          <td className="num">{sale.sequence}</td>
                          <td className="nowrap">{formatDateTime(sale.timestamp)}</td>
                          <td className="strong nowrap">{sale.receiptCode}</td>
                          <td className="nowrap">{sale.type === "WALK_IN" ? "Walk-in" : "Reservation"}</td>
                          <td>{sale.studentNumber ? `${sale.studentName} (${sale.studentNumber})` : sale.studentName}</td>
                          <td className="nowrap">{sale.orderReference ?? "—"}</td>
                          <td className="lines">{sale.itemLines.join("\n")}</td>
                          <td className="num">{sale.quantity.toLocaleString("en-PH")}</td>
                          <td>{sale.collectionPoint === "TREASURER" ? "Treasury" : "Commissary"}</td>
                          <td>{sale.cashierName ?? "—"}</td>
                          <td className="num strong">{formatPeso(sale.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={7} className="num">Grand Total</td>
                        <td className="num">{summary.totalUnitsSold.toLocaleString("en-PH")}</td>
                        <td colSpan={2} />
                        <td className="num srd-positive">{formatPeso(summary.totalRecognizedSales)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                <p className="srd-empty">No valid sales found for this period.</p>
              )}
            </section>

            <section className="srd-section" aria-labelledby="srd-products-heading">
              <h3 id="srd-products-heading" className="srd-heading">Product Summary</h3>
              {report.productSummary.length ? (
                <div className="srd-table-wrap">
                  <table className="srd-table srd-table--products">
                    <thead>
                      <tr>
                        {["Item", "Category", "SKU/Option"].map((heading) => <th key={heading} scope="col">{heading}</th>)}
                        {["Quantity Sold", "Sales", "COGS", "Gross Profit"].map((heading) => <th key={heading} scope="col" className="num">{heading}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {report.productSummary.map((row) => (
                        <tr key={`${row.item}-${row.skuOrOption ?? ""}`}>
                          <td className="strong">{row.item}</td>
                          <td>{row.category ?? "—"}</td>
                          <td>{row.skuOrOption ?? "—"}</td>
                          <td className="num">{row.quantity.toLocaleString("en-PH")}</td>
                          <td className="num">{formatPeso(row.sales)}</td>
                          <td className="num">{formatPeso(row.cogs)}</td>
                          <td className="num strong srd-positive">{formatPeso(row.grossProfit)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={3} className="num">Total</td>
                        <td className="num">{productTotals.quantity.toLocaleString("en-PH")}</td>
                        <td className="num">{formatPeso(productTotals.sales)}</td>
                        <td className="num">{formatPeso(productTotals.cogs)}</td>
                        <td className="num srd-positive">{formatPeso(productTotals.grossProfit)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                <p className="srd-empty">No products sold in this period.</p>
              )}
            </section>

            <div className={report.voids.length <= COMPACT_CLOSING_MAX_VOIDS ? "srd-closing srd-closing--compact" : "srd-closing"}>
              <section className="srd-section" aria-labelledby="srd-voids-heading">
                <h3 id="srd-voids-heading" className="srd-heading srd-heading--void">Voided Transactions</h3>
                {report.voids.length ? (
                  <div className="srd-table-wrap">
                    <table className="srd-table srd-table--voids">
                      <thead>
                        <tr>
                          {["Receipt", "Original Sale Date", "Void Date", "Type"].map((heading) => <th key={heading} scope="col">{heading}</th>)}
                          <th scope="col" className="num">Amount</th>
                          {["Reason", "Cashier", "Voided By"].map((heading) => <th key={heading} scope="col">{heading}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {report.voids.map((voidRow) => (
                          <tr key={`${voidRow.receiptCode}-${voidRow.voidedAt}`}>
                            <td className="strong">{voidRow.receiptCode}</td>
                            <td className="nowrap">{voidRow.originalSaleAt ? formatDateTime(voidRow.originalSaleAt) : "—"}</td>
                            <td className="nowrap">{formatDateTime(voidRow.voidedAt)}</td>
                            <td>{voidRow.type === "WALK_IN" ? "Walk-in" : "Reservation"}</td>
                            <td className="num strong srd-negative">{formatPeso(voidRow.amount)}</td>
                            <td>{voidRow.reason ?? "—"}</td>
                            <td>{voidRow.cashierName ?? "—"}</td>
                            <td>{voidRow.voidedBy ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan={4} className="num">Total void amount (not part of recognized sales)</td>
                          <td className="num srd-negative">{formatPeso(summary.voidsProcessed.amount)}</td>
                          <td colSpan={3} />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                ) : (
                  <p className="srd-empty">No voids processed in this period.</p>
                )}
              </section>

              <div className="srd-signoff">
                <footer className="srd-signatures">
                  {["Prepared by", "Reviewed by", "Approved by"].map((label) => (
                    <div key={label}>
                      <p className="srd-signature">{label}: ______________________</p>
                      <p className="srd-signature-caption">Signature over printed name / Date</p>
                    </div>
                  ))}
                </footer>
                <p className="srd-footnote">System-generated by WESCOMM. Amounts are in Philippine pesos (₱). Voided transactions are excluded from recognized sales.</p>
              </div>
            </div>
          </article>

          <div className="mt-4 flex flex-wrap gap-2 no-print">
            <Button onClick={() => void printReport()}>
              <Printer className="size-4" />
              Print
            </Button>
            <Button variant="secondary" onClick={() => void downloadExcel()} disabled={downloading}>
              {downloading ? <RefreshIcon /> : <Download className="size-4" />}
              {downloading ? "Preparing..." : "Download Sales Excel"}
            </Button>
            <Button variant="secondary" onClick={onClose}>
              <X className="size-4" />
              Close Preview
            </Button>
          </div>
        </div>
      ) : !loading && !error ? (
        <div className="p-6 text-sm font-semibold text-muted-foreground no-print">Select a period and press Preview Report to generate the printable sales report.</div>
      ) : null}
    </section>
  );
}

function RefreshIcon() {
  return <AssetIcon src="/assets/download.svg" className="size-4" />;
}
