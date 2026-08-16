"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { ArrowRight, ChevronDown, Download, RefreshCw } from "lucide-react";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import { SiteFooterLinks } from "@/components/layout/SiteFooterLinks";
import { AssetIcon } from "@/components/ui/AssetIcon";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { getStaffReportSummaryFromApi, type BackendReportSummary } from "@/lib/api";
import { exportStyledExcelWorkbook } from "@/lib/excel-export";
import { getStoredStaffSession } from "@/lib/staff-api";

const emptySummary: BackendReportSummary = {
  totalSales: 0,
  totalReservations: 0,
  pendingReservations: 0,
  lowStockItems: 0,
  outOfStockItems: 0,
  totalProducts: 0,
  inventoryValue: 0,
  activeUsers: 0,
  roleCounts: { students: 0, staff: 0, admins: 0 },
  receiptsToVerify: 0,
  totalReceipts: 0,
  activeConversations: 0,
  salesTrend: [],
  categorySales: [],
  reservationStatusDistribution: [],
  inventoryInsights: []
};

const statusColors = ["#16803c", "#8cc665", "#f5b000", "#9aa3a8", "#00652f"];

type ReportExport = {
  name: string;
  date: string;
  range: string;
  by: string;
  format: "PDF" | "Excel";
};

function formatCurrency(value: number) {
  return `PHP ${value.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function formatNumber(value: number) {
  return value.toLocaleString("en-PH");
}

function formatExportDate() {
  return new Date().toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Manila"
  });
}

function useStaffReportsSummary() {
  const { user, ready, openAuth } = useStudentAuth();
  const [summary, setSummary] = useState<BackendReportSummary>(emptySummary);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [hasCredential, setHasCredential] = useState(false);

  const loadSummary = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
    if (!ready) return;

    const storedSession = getStoredStaffSession();
    const userCanUseStaffApi = user?.role === "STAFF" || user?.role === "ADMIN";
    const token = userCanUseStaffApi ? user.accessToken ?? "" : !user ? storedSession.token : "";
    setHasCredential(Boolean(token));

    if (!token) {
      setLoading(false);
      return;
    }

    if (!background) {
      setLoading(true);
      setError("");
    }

    try {
      const data = await getStaffReportSummaryFromApi(token);
      setSummary(data);
    } catch (summaryError) {
      if (!background) {
        setError(summaryError instanceof Error ? summaryError.message : "Unable to load staff reports.");
      }
    } finally {
      if (!background) setLoading(false);
    }
  }, [ready, user]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    if (!hasCredential) return;

    const refresh = () => {
      if (document.visibilityState === "visible") void loadSummary({ background: true });
    };

    const interval = window.setInterval(refresh, 20000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [hasCredential, loadSummary]);

  return { user, ready, openAuth, summary, loading, error, hasCredential, reload: loadSummary };
}

function ReportStat({
  title,
  value,
  detail,
  iconSrc,
  warning = false
}: {
  title: string;
  value: string;
  detail: string;
  iconSrc: string;
  warning?: boolean;
}) {
  return (
    <article className="rounded-lg border border-[#dce5dd] bg-white p-5 shadow-sm">
      <div className="flex items-start gap-4">
        <span className={warning ? "grid size-16 shrink-0 place-items-center rounded-full bg-[#fff2d4]" : "grid size-16 shrink-0 place-items-center rounded-full bg-[#eaf4ea]"}>
          <AssetIcon src={iconSrc} className="size-11" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-bold text-[#27332c]">{title}</p>
          <p className={warning ? "mt-1 text-2xl font-extrabold text-[#f0a400]" : "mt-1 text-2xl font-extrabold text-primary"}>{value}</p>
          <p className="mt-1 text-xs text-[#68746d]">{detail}</p>
        </div>
      </div>
    </article>
  );
}

function ChartCard({
  title,
  action,
  children
}: {
  title: string;
  action: string;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-[#dce5dd] bg-white shadow-sm">
      <div className="flex h-14 items-center border-b border-[#e5ebe6] px-4">
        <h2 className="font-extrabold text-[#17211b]">{title}</h2>
        <span className="ml-auto rounded-md bg-[#f3f7f3] px-3 py-1.5 text-xs font-semibold text-[#4f5b54]">{action}</span>
      </div>
      {children}
    </section>
  );
}

function EmptyPanel({ children }: { children: ReactNode }) {
  return <div className="p-5 text-sm font-semibold text-[#68746d]">{children}</div>;
}

function StaffReportAccessState({
  ready,
  loading,
  hasCredential,
  user,
  openAuth
}: {
  ready: boolean;
  loading: boolean;
  hasCredential: boolean;
  user: ReturnType<typeof useStudentAuth>["user"];
  openAuth: () => void;
}) {
  if (!ready || (loading && !hasCredential)) {
    return <div className="rounded-lg border border-[#dce5dd] bg-white p-6 text-sm font-semibold text-[#68746d] shadow-sm">Loading staff reports...</div>;
  }

  if (user?.role === "STUDENT") {
    return <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm font-semibold text-red-700">This page is restricted to staff and admin accounts.</div>;
  }

  if (!hasCredential) {
    return (
      <section className="rounded-lg border border-[#dce5dd] bg-white p-6 shadow-sm">
        <p className="font-extrabold text-[#17211b]">Staff sign in required</p>
        <p className="mt-2 text-sm text-[#68746d]">Use a staff or admin Wesleyan account to load live reports.</p>
        <Button className="mt-5" onClick={openAuth}>Sign in</Button>
      </section>
    );
  }

  return null;
}

function insightIcon(insight: BackendReportSummary["inventoryInsights"][number]) {
  if (insight.impact === "High") return "/assets/low-stock.svg";
  if (insight.impact === "Positive") return "/assets/in-stock.svg";
  return "/assets/restock-soon.svg";
}

export function StaffReports() {
  const { user, ready, openAuth, summary, loading, error, hasCredential, reload } = useStaffReportsSummary();
  const [exports, setExports] = useState<ReportExport[]>([]);
  const [showAllExports, setShowAllExports] = useState(false);

  const accessState = (
    <StaffReportAccessState
      ready={ready}
      loading={loading}
      hasCredential={hasCredential}
      user={user}
      openAuth={openAuth}
    />
  );

  const reportOwner = user?.fullName || getStoredStaffSession().email || "Staff";
  const reportRange = summary.salesTrend.length
    ? `${summary.salesTrend[0].day} - ${summary.salesTrend[summary.salesTrend.length - 1].day}`
    : "Live database summary";

  const reservationStatus = useMemo(
    () =>
      summary.reservationStatusDistribution.map((status, index) => ({
        name: status.label,
        value: status.value,
        color: statusColors[index % statusColors.length]
      })),
    [summary.reservationStatusDistribution]
  );

  const totalReservations = reservationStatus.reduce((total, status) => total + status.value, 0);

  const recordExport = (format: "PDF" | "Excel") => {
    setExports((current) => [
      {
        name: "WESCOMM Live Performance Report",
        date: formatExportDate(),
        range: reportRange,
        by: reportOwner,
        format
      },
      ...current
    ].slice(0, 8));
  };

  const exportExcel = () => {
    exportStyledExcelWorkbook({
      fileName: "wescomm-staff-report.xls",
      worksheetName: "Staff Report",
      title: "WESCOMM Staff Performance Report",
      subtitle: "Wesleyan Integrated Commissary Management System",
      metadata: [
        ["Date exported", formatExportDate()],
        ["Report range", reportRange],
        ["Exported by", reportOwner],
        ["Data source", "Live WESCOMM database"]
      ],
      sections: [
        {
          title: "Summary Metrics",
          headers: ["Metric", "Value", "Operational Note"],
          rows: [
            ["Total Sales", formatCurrency(summary.totalSales), `${formatNumber(summary.totalReceipts)} verified receipt records`],
            ["Total Reservations", formatNumber(summary.totalReservations), `${formatNumber(summary.pendingReservations)} pending staff review`],
            ["Inventory Value", formatCurrency(summary.inventoryValue), `${formatNumber(summary.totalProducts)} active products`],
            ["Items Needing Restock", formatNumber(summary.lowStockItems), "Products at or below the staff restock alert count"],
            ["Receipts to Verify", formatNumber(summary.receiptsToVerify), "Digital receipts waiting for staff action"],
            ["Active Conversations", formatNumber(summary.activeConversations), "Student support threads currently open"]
          ]
        },
        {
          title: "Sales Trend",
          headers: ["Day", "Sales"],
          rows: summary.salesTrend.length
            ? summary.salesTrend.map((item) => [item.day, formatCurrency(item.sales)])
            : [["No sales trend data yet", ""]]
        },
        {
          title: "Top Categories by Sales",
          headers: ["Category", "Sales"],
          rows: summary.categorySales.length
            ? summary.categorySales.map((item) => [item.category, formatCurrency(item.amount)])
            : [["No category sales data yet", ""]]
        },
        {
          title: "Reservation Status Distribution",
          headers: ["Status", "Reservations"],
          rows: reservationStatus.length
            ? reservationStatus.map((status) => [status.name, formatNumber(status.value)])
            : [["No reservation status data yet", ""]]
        },
        {
          title: "Inventory Insights",
          headers: ["Insight", "Impact", "Recommendation"],
          rows: summary.inventoryInsights.length
            ? summary.inventoryInsights.map((insight) => [insight.insight, insight.impact, insight.recommendation])
            : [["No inventory insights available yet", "", ""]]
        }
      ]
    });
    recordExport("Excel");
  };

  const exportPdf = () => {
    recordExport("PDF");
    window.print();
  };

  const downloadRecordedExport = (report: ReportExport) => {
    const content = [
      "WESCOMM REPORT",
      `Report: ${report.name}`,
      `Date exported: ${report.date}`,
      `Date range: ${report.range}`,
      `Exported by: ${report.by}`,
      `Format: ${report.format}`,
      "",
      `Total sales: ${formatCurrency(summary.totalSales)}`,
      `Total reservations: ${formatNumber(summary.totalReservations)}`,
      `Inventory value: ${formatCurrency(summary.inventoryValue)}`,
      `Items to restock: ${formatNumber(summary.lowStockItems)}`
    ].join("\n");
    const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${report.name.toLowerCase().replaceAll(" ", "-")}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (!ready || !hasCredential || user?.role === "STUDENT") return accessState;

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold text-[#111a15] sm:text-4xl">Reports</h1>
          <p className="mt-2 text-sm text-[#606c64] sm:text-base">Track performance, analyze trends, and export live backend insights.</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button variant="secondary" className="h-11" onClick={() => void reload()} disabled={loading}>
            <RefreshCw className="size-4" />
            Refresh
          </Button>
          <Button variant="secondary" className="h-11" onClick={exportPdf}>
            <AssetIcon src="/assets/digital-receipts.svg" className="size-6" />
            Export PDF
          </Button>
          <Button variant="secondary" className="h-11" onClick={exportExcel}>
            <AssetIcon src="/assets/download.svg" className="size-6" />
            Export Excel
          </Button>
        </div>
      </header>

      <div className="w-fit rounded-md border border-[#d7e0d8] bg-white px-3 py-2 text-sm font-semibold text-[#344139]">
        Report range: <span className="text-primary">{reportRange}</span>
      </div>

      {error ? <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p> : null}
      {loading ? <div className="rounded-lg border border-[#dce5dd] bg-white p-6 text-sm font-semibold text-[#68746d] shadow-sm">Loading live report data...</div> : null}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ReportStat title="Total Sales" value={formatCurrency(summary.totalSales)} detail={`${formatNumber(summary.totalReceipts)} receipts recorded`} iconSrc="/assets/cash.svg" />
        <ReportStat title="Total Reservations" value={formatNumber(summary.totalReservations)} detail={`${formatNumber(summary.pendingReservations)} pending staff review`} iconSrc="/assets/reservations.svg" />
        <ReportStat title="Inventory Value" value={formatCurrency(summary.inventoryValue)} detail={`${formatNumber(summary.totalProducts)} active products`} iconSrc="/assets/all-items.svg" />
        <ReportStat title="Items to Restock" value={formatNumber(summary.lowStockItems)} detail="Reached the restock alert count" iconSrc="/assets/low-stock.svg" warning={summary.lowStockItems > 0} />
      </section>

      <section className="grid gap-5 xl:grid-cols-3">
        <ChartCard title="Sales Trend" action="Last 7 days">
          <div className="h-[310px] p-4">
            {summary.salesTrend.length ? (
              <>
                <div className="mb-3 flex flex-wrap gap-4 text-xs text-[#647068]">
                  <span className="flex items-center gap-2"><span className="h-1 w-5 rounded bg-primary" /> Live sales</span>
                </div>
                <ResponsiveContainer width="100%" height="88%">
                  <LineChart data={summary.salesTrend} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="#e5ebe6" />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={(value) => `PHP ${Math.round(Number(value) / 1000)}K`} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip formatter={(value: number) => formatCurrency(value)} />
                    <Line type="monotone" dataKey="sales" stroke="#08742f" strokeWidth={3} dot={{ r: 3, fill: "#08742f" }} />
                  </LineChart>
                </ResponsiveContainer>
              </>
            ) : (
              <EmptyPanel>No sales trend data yet.</EmptyPanel>
            )}
          </div>
        </ChartCard>

        <ChartCard title="Top Categories by Sales" action="Live data">
          <div className="h-[310px] p-4">
            {summary.categorySales.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={summary.categorySales} layout="vertical" margin={{ top: 5, right: 55, left: 8, bottom: 0 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="category" width={105} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(value: number) => formatCurrency(value)} />
                  <Bar dataKey="amount" fill="#16803c" radius={[0, 4, 4, 0]} barSize={13}>
                    <LabelList dataKey="amount" position="right" formatter={(value: number) => `PHP ${Math.round(Number(value) / 1000)}K`} style={{ fontSize: 10, fontWeight: 700, fill: "#176b36" }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyPanel>No category sales data yet.</EmptyPanel>
            )}
          </div>
        </ChartCard>

        <ChartCard title="Reservation Status Distribution" action="Live data">
          <div className="grid min-h-[310px] items-center gap-3 p-4 sm:grid-cols-[1fr_1fr] xl:grid-cols-1 2xl:grid-cols-[1fr_1fr]">
            {reservationStatus.length ? (
              <>
                <div className="relative mx-auto h-52 w-full max-w-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={reservationStatus} dataKey="value" nameKey="name" innerRadius={52} outerRadius={82} paddingAngle={1}>
                        {reservationStatus.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
                    <div>
                      <p className="text-2xl font-extrabold text-primary">{formatNumber(totalReservations)}</p>
                      <p className="text-xs text-[#69746e]">Total</p>
                    </div>
                  </div>
                </div>
                <div className="space-y-3">
                  {reservationStatus.map((status) => (
                    <div key={status.name} className="grid grid-cols-[auto_1fr_auto] items-center gap-2 text-xs">
                      <span className="size-2.5 rounded-full" style={{ backgroundColor: status.color }} />
                      <span className="text-[#536058]">{status.name}</span>
                      <span className="font-bold">{formatNumber(status.value)}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <EmptyPanel>No reservation status data yet.</EmptyPanel>
            )}
          </div>
        </ChartCard>
      </section>

      <section className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <details className="group overflow-hidden rounded-lg border border-[#dce5dd] bg-white shadow-sm">
          <summary className="flex min-h-[72px] cursor-pointer list-none items-center gap-3 px-4 py-3 marker:content-none sm:px-5">
            <span className="grid size-11 shrink-0 place-items-center rounded-md bg-[#eef6ee]">
              <AssetIcon src="/assets/download.svg" className="size-8" />
            </span>
            <span className="min-w-0">
              <span className="block font-extrabold text-[#17211b]">Recent Report Exports</span>
              <span className="mt-0.5 block text-xs text-[#68746d]">{exports.length} generated report file{exports.length === 1 ? "" : "s"} this session</span>
            </span>
            <ChevronDown className="ml-auto size-5 shrink-0 text-primary transition-transform group-open:rotate-180" />
          </summary>
          <div className="border-t border-[#e5ebe6]">
            {exports.length ? (
              <>
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full min-w-[680px] text-left text-xs">
                    <thead className="bg-[#f8faf8] text-[#59655d]">
                      <tr>
                        {["Report Name", "Date Exported", "Date Range", "Exported By", "Format", "Action"].map((heading) => (
                          <th key={heading} className="px-4 py-3 font-bold">{heading}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#e7ede8]">
                      {(showAllExports ? exports : exports.slice(0, 5)).map((report, index) => (
                        <tr key={`${report.name}-${index}`}>
                          <td className="px-4 py-3 font-semibold">{report.name}</td>
                          <td className="px-4 py-3">{report.date}</td>
                          <td className="px-4 py-3">{report.range}</td>
                          <td className="px-4 py-3">{report.by}</td>
                          <td className="px-4 py-3">{report.format}</td>
                          <td className="px-4 py-3">
                            <button type="button" onClick={() => downloadRecordedExport(report)} aria-label={`Download ${report.name}`} className="grid size-8 place-items-center rounded-md text-primary hover:bg-[#eef6ee]">
                              <Download className="size-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="divide-y divide-[#e7ede8] md:hidden">
                  {(showAllExports ? exports : exports.slice(0, 5)).map((report, index) => (
                    <article key={`${report.name}-${index}`} className="p-4">
                      <div className="flex gap-3">
                        <AssetIcon src="/assets/digital-receipts.svg" className="size-8" />
                        <div className="min-w-0">
                          <h3 className="font-bold">{report.name}</h3>
                          <p className="mt-1 text-xs text-[#68746d]">{report.date}</p>
                          <p className="mt-1 text-xs text-[#68746d]">{report.range} - {report.format}</p>
                        </div>
                        <button type="button" onClick={() => downloadRecordedExport(report)} aria-label={`Download ${report.name}`} className="ml-auto grid size-9 place-items-center rounded-md text-primary hover:bg-[#eef6ee]"><Download className="size-4" /></button>
                      </div>
                    </article>
                  ))}
                </div>
                <button type="button" onClick={() => setShowAllExports((current) => !current)} className="flex min-h-12 items-center gap-2 border-t border-[#e5ebe6] px-4 text-sm font-bold text-primary">
                  {showAllExports ? "Show recent exports" : "View all exports"} <ArrowRight className="size-4" />
                </button>
              </>
            ) : (
              <EmptyPanel>No exported reports yet. Use Export PDF or Export Excel to create one from the live data.</EmptyPanel>
            )}
          </div>
        </details>

        <details className="group overflow-hidden rounded-lg border border-[#dce5dd] bg-white shadow-sm">
          <summary className="flex min-h-[72px] cursor-pointer list-none items-center gap-3 px-4 py-3 marker:content-none sm:px-5">
            <span className="grid size-11 shrink-0 place-items-center rounded-md bg-[#eef6ee]">
              <AssetIcon src="/assets/in-stock.svg" className="size-8" />
            </span>
            <span className="min-w-0">
              <span className="block font-extrabold text-[#17211b]">Inventory Insights</span>
              <span className="mt-0.5 block text-xs text-[#68746d]">{summary.inventoryInsights.length} operational finding{summary.inventoryInsights.length === 1 ? "" : "s"}</span>
            </span>
            <ChevronDown className="ml-auto size-5 shrink-0 text-primary transition-transform group-open:rotate-180" />
          </summary>
          <div className="border-t border-[#e5ebe6]">
            {summary.inventoryInsights.length ? (
              <div className="divide-y divide-[#e7ede8]">
                {summary.inventoryInsights.map((insight) => (
                  <article key={insight.insight} className="grid gap-3 p-4 text-sm sm:grid-cols-[1.2fr_auto_1fr] sm:items-center">
                    <div className="flex items-center gap-3">
                      <AssetIcon src={insightIcon(insight)} className="size-8" />
                      <p className="font-bold text-[#253029]">{insight.insight}</p>
                    </div>
                    <StatusBadge status={insight.impact} />
                    <p className="text-[#4f5b54]">{insight.recommendation}</p>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyPanel>No inventory insights available yet.</EmptyPanel>
            )}
            <Link href="/staff/inventory?status=needs-restock" className="flex min-h-12 items-center gap-2 border-t border-[#e5ebe6] px-4 text-sm font-bold text-primary">Review affected inventory <ArrowRight className="size-4" /></Link>
          </div>
        </details>
      </section>

      <footer className="flex flex-col items-center gap-4 border-t border-[#e2e8e3] py-6 text-center text-xs text-[#68736c] md:flex-row md:justify-between md:text-left">
        <div className="flex items-center justify-center gap-3 md:justify-start">
          <AssetIcon src="/assets/wescomm-logo.png" className="h-10 w-24" />
          <div>
            <p className="font-extrabold text-[#26322b]">Wesleyan University-Philippines</p>
            <p>Integrated Commissary Management System</p>
          </div>
        </div>
        <SiteFooterLinks />
        <p className="md:text-right">© 2026 Wesleyan University-Philippines</p>
      </footer>
    </div>
  );
}
