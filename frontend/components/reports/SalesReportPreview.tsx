"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Download, Printer, X } from "lucide-react";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import { Button } from "@/components/ui/button";
import { AssetIcon } from "@/components/ui/AssetIcon";
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

  useEffect(() => {
    return () => requestAbortRef.current?.abort();
  }, []);

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

  return (
    <section className="rounded-lg border bg-white shadow-sm">
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

      {error ? <p className="no-print mx-5 mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p> : null}
      {loading ? <div className="no-print p-6 text-sm font-semibold text-muted-foreground">Loading sales report data...</div> : null}

      {report && summary ? (
        <div className="p-5">
          {!report.sales.length ? (
            <div className="no-print mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p className="font-extrabold">No valid sales were recorded for {report.range.label}.</p>
              <p className="mt-1 text-xs font-semibold">You may still print or download this zero-activity report for the official record.</p>
            </div>
          ) : null}
          <div id="sales-report-print-area" className="rounded-lg border bg-white">
            <header className="border-b border-border px-6 py-5 text-center">
              <p className="text-2xl font-extrabold tracking-wide text-primary">WESCOMM</p>
              <p className="mt-1 text-sm font-extrabold text-foreground">{PERIOD_TITLES[report.range.period]}</p>
              <p className="text-xs text-muted-foreground">Wesleyan University-Philippines — Integrated Commissary Management System</p>
              <p className="mt-2 text-sm font-bold text-foreground">Reporting period: {report.range.label}</p>
              <div className="mt-2 flex flex-wrap justify-center gap-x-6 gap-y-1 text-xs text-muted-foreground">
                <span>Generated: {formatDateTime(report.generatedAt)}</span>
                <span>Generated by: {report.generatedBy ?? "Not recorded"}</span>
                <span>Timezone: Asia/Manila</span>
                <span>Channel: {CHANNEL_LABELS[report.filters.channel]}</span>
                <span>Location: {LOCATION_LABELS[report.filters.collectionLocation]}</span>
              </div>
            </header>

            <div className="grid gap-px border-b border-border bg-border px-6 py-5 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div className="bg-white p-3">
                <p className="text-xs font-bold text-muted-foreground">Valid sales transactions</p>
                <p className="mt-1 text-lg font-extrabold text-foreground">{summary.validSalesTransactions.toLocaleString("en-PH")}</p>
              </div>
              <div className="bg-white p-3">
                <p className="text-xs font-bold text-muted-foreground">Total units sold</p>
                <p className="mt-1 text-lg font-extrabold text-foreground">{summary.totalUnitsSold.toLocaleString("en-PH")}</p>
              </div>
              <div className="bg-white p-3">
                <p className="text-xs font-bold text-muted-foreground">Reservation sales</p>
                <p className="mt-1 text-lg font-extrabold text-foreground">{formatPeso(summary.reservationSales.amount)}</p>
                <p className="text-xs text-muted-foreground">{summary.reservationSales.count.toLocaleString("en-PH")} transaction(s)</p>
              </div>
              <div className="bg-white p-3">
                <p className="text-xs font-bold text-muted-foreground">Walk-in sales</p>
                <p className="mt-1 text-lg font-extrabold text-foreground">{formatPeso(summary.walkInSales.amount)}</p>
                <p className="text-xs text-muted-foreground">{summary.walkInSales.count.toLocaleString("en-PH")} transaction(s)</p>
              </div>
              <div className="bg-white p-3">
                <p className="text-xs font-bold text-muted-foreground">Total recognized sales</p>
                <p className="mt-1 text-lg font-extrabold text-primary">{formatPeso(summary.totalRecognizedSales)}</p>
              </div>
              <div className="bg-white p-3">
                <p className="text-xs font-bold text-muted-foreground">Voids processed</p>
                <p className="mt-1 text-lg font-extrabold text-foreground">{summary.voidsProcessed.count.toLocaleString("en-PH")}</p>
                <p className="text-xs text-muted-foreground">Listed in the Voided Transactions section</p>
              </div>
              <div className="bg-white p-3">
                <p className="text-xs font-bold text-muted-foreground">Void amount (excluded from valid sales)</p>
                <p className="mt-1 text-lg font-extrabold text-red-700">{formatPeso(summary.voidsProcessed.amount)}</p>
              </div>
            </div>

            <div className="px-6 py-5">
              <h3 className="text-sm font-extrabold text-foreground">Main Sales Register</h3>
              {report.sales.length ? (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[900px] border-collapse text-left text-xs">
                    <thead>
                      <tr className="bg-primary text-white">
                        {["#", "Date/Time", "Receipt No.", "Type", "Student/Buyer", "Order Ref.", "Items", "Qty", "Collection Point", "Cashier", "Amount"].map((heading) => (
                          <th key={heading} className="border border-[#b8d7bf] px-2 py-2 font-bold">{heading}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {report.sales.map((sale) => (
                        <tr key={`${sale.receiptCode}-${sale.sequence}`} className="align-top odd:bg-white even:bg-[#f3f8f4]">
                          <td className="border px-2 py-2 text-right">{sale.sequence}</td>
                          <td className="border px-2 py-2 whitespace-nowrap">{formatDateTime(sale.timestamp)}</td>
                          <td className="border px-2 py-2 font-bold">{sale.receiptCode}</td>
                          <td className="border px-2 py-2">{sale.type === "WALK_IN" ? "Walk-in" : "Reservation"}</td>
                          <td className="border px-2 py-2">{sale.studentNumber ? `${sale.studentName} (${sale.studentNumber})` : sale.studentName}</td>
                          <td className="border px-2 py-2">{sale.orderReference ?? "—"}</td>
                          <td className="border px-2 py-2 whitespace-pre-wrap">{sale.itemLines.join("\n")}</td>
                          <td className="border px-2 py-2 text-right">{sale.quantity}</td>
                          <td className="border px-2 py-2">{sale.collectionPoint === "TREASURER" ? "Treasury" : "Commissary"}</td>
                          <td className="border px-2 py-2">{sale.cashierName ?? "—"}</td>
                          <td className="border px-2 py-2 text-right font-bold">{formatPeso(sale.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-muted font-extrabold">
                        <td colSpan={10} className="border px-2 py-2 text-right">Grand Total</td>
                        <td className="border px-2 py-2 text-right text-primary">{formatPeso(summary.totalRecognizedSales)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                <p className="mt-3 rounded-md border bg-muted/40 px-4 py-6 text-center text-sm font-semibold text-muted-foreground">No valid sales found for this period.</p>
              )}
            </div>

            <div className="border-t border-border px-6 py-5">
              <h3 className="text-sm font-extrabold text-foreground">Product Summary</h3>
              {report.productSummary.length ? (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[640px] border-collapse text-left text-xs">
                    <thead>
                      <tr className="bg-primary text-white">
                        {["Item", "Category", "SKU/Option", "Quantity Sold", "Sales", "COGS", "Gross Profit"].map((heading) => (
                          <th key={heading} className="border border-[#b8d7bf] px-2 py-2 font-bold">{heading}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {report.productSummary.map((row) => (
                        <tr key={`${row.item}-${row.skuOrOption ?? ""}`} className="odd:bg-white even:bg-[#f3f8f4]">
                          <td className="border px-2 py-2 font-bold">{row.item}</td>
                          <td className="border px-2 py-2">{row.category ?? "—"}</td>
                          <td className="border px-2 py-2">{row.skuOrOption ?? "—"}</td>
                          <td className="border px-2 py-2 text-right">{row.quantity}</td>
                          <td className="border px-2 py-2 text-right">{formatPeso(row.sales)}</td>
                          <td className="border px-2 py-2 text-right">{formatPeso(row.cogs)}</td>
                          <td className="border px-2 py-2 text-right font-bold text-primary">{formatPeso(row.grossProfit)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="mt-3 rounded-md border bg-muted/40 px-4 py-4 text-center text-sm font-semibold text-muted-foreground">No products sold in this period.</p>
              )}
            </div>

            <div className="border-t border-border px-6 py-5">
              <h3 className="text-sm font-extrabold text-foreground">Voided Transactions</h3>
              {report.voids.length ? (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[720px] border-collapse text-left text-xs">
                    <thead>
                      <tr className="bg-[#8c2f28] text-white">
                        {["Void Date/Time", "Original Receipt", "Type", "Amount", "Cashier", "Voided By", "Reason"].map((heading) => (
                          <th key={heading} className="border border-[#b8d7bf] px-2 py-2 font-bold">{heading}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {report.voids.map((voidRow) => (
                        <tr key={`${voidRow.receiptCode}-${voidRow.voidedAt}`} className="align-top odd:bg-white even:bg-[#f3f8f4]">
                          <td className="border px-2 py-2 whitespace-nowrap">{formatDateTime(voidRow.voidedAt)}</td>
                          <td className="border px-2 py-2 font-bold">{voidRow.receiptCode}</td>
                          <td className="border px-2 py-2">{voidRow.type === "WALK_IN" ? "Walk-in" : "Reservation"}</td>
                          <td className="border px-2 py-2 text-right font-bold text-red-700">{formatPeso(voidRow.amount)}</td>
                          <td className="border px-2 py-2">{voidRow.cashierName ?? "—"}</td>
                          <td className="border px-2 py-2">{voidRow.voidedBy ?? "—"}</td>
                          <td className="border px-2 py-2">{voidRow.reason ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-muted font-extrabold">
                        <td colSpan={3} className="border px-2 py-2 text-right">Total void amount (not part of recognized sales)</td>
                        <td className="border px-2 py-2 text-right text-red-700">{formatPeso(summary.voidsProcessed.amount)}</td>
                        <td colSpan={3} className="border px-2 py-2" />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                <p className="mt-3 rounded-md border bg-muted/40 px-4 py-4 text-center text-sm font-semibold text-muted-foreground">No voids processed in this period.</p>
              )}
            </div>

            <footer className="border-t border-border px-6 py-5">
              <div className="flex flex-wrap justify-between gap-4 text-sm font-bold">
                <span>Prepared by: ______________________</span>
                <span>Reviewed by: ______________________</span>
                <span>Approved by: ______________________</span>
              </div>
              <p className="mt-4 text-center text-xs text-muted-foreground">Zero-activity reports remain printable for official daily records.</p>
            </footer>
          </div>

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
