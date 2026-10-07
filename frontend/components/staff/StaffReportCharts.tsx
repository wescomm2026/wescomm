"use client";

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
import type { ReactNode } from "react";
import type { BackendReportSummary } from "@/lib/api";

const statusColors = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))"
];

function formatCurrency(value: number) {
  return `PHP ${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatNumber(value: number) {
  return value.toLocaleString("en-PH");
}

function ChartCard({ title, action, children }: { title: string; action: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border bg-card shadow-sm">
      <div className="flex h-14 items-center border-b border-border px-4">
        <h2 className="font-extrabold text-foreground">{title}</h2>
        <span className="ml-auto rounded-md bg-surface-subtle px-3 py-1.5 text-xs font-semibold text-muted-foreground">{action}</span>
      </div>
      {children}
    </section>
  );
}

function EmptyPanel({ children }: { children: ReactNode }) {
  return <div className="p-5 text-sm font-semibold text-muted-foreground">{children}</div>;
}

export function StaffReportCharts({ summary }: { summary: BackendReportSummary }) {
  const primaryTrend = summary.reportBasis === "COLLECTION" ? summary.collectionTrend : summary.salesTrend;
  const primaryTrendLabel = summary.reportBasis === "COLLECTION" ? "Cash Collection Trend" : "Recognized Sales Trend";
  const reservationStatus = summary.reservationStatusDistribution.map((status, index) => ({
    name: status.label,
    value: status.value,
    color: statusColors[index % statusColors.length]
  }));
  const totalReservations = reservationStatus.reduce((total, status) => total + status.value, 0);
  const topCategories = [...summary.categorySales]
    .sort((left, right) => right.sales - left.sales || left.category.localeCompare(right.category))
    .slice(0, 3);

  return (
    <section id="reservation-status" className="scroll-mt-24 grid gap-5 xl:grid-cols-2 2xl:grid-cols-3">
      <ChartCard title={primaryTrendLabel} action={summary.range.label}>
        <div className="h-[310px] p-4">
          {primaryTrend.length ? (
            <>
              <div className="mb-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-2"><span className="h-1 w-5 rounded bg-primary" /> {summary.reportBasis === "COLLECTION" ? "Cash received by payment date" : "Completed sales by completion date"}</span>
              </div>
              <ResponsiveContainer width="100%" height="88%">
                <LineChart data={primaryTrend} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="hsl(var(--chart-grid))" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={(value) => `PHP ${Math.round(Number(value) / 1000)}K`} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(value: number) => formatCurrency(value)} />
                  <Line type="monotone" dataKey="sales" stroke="hsl(var(--chart-1))" strokeWidth={3} dot={{ r: 3, fill: "hsl(var(--chart-1))" }} />
                </LineChart>
              </ResponsiveContainer>
            </>
          ) : <EmptyPanel>No {summary.reportBasis === "COLLECTION" ? "cash collection" : "completed sales"} trend data yet.</EmptyPanel>}
        </div>
      </ChartCard>

      <ChartCard title="Top Categories by Sales" action="Top 3">
        <div className="h-[310px] p-4">
          {summary.categorySales.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topCategories} layout="vertical" margin={{ top: 5, right: 55, left: 8, bottom: 0 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="category" width={105} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(value: number) => formatCurrency(value)} />
                <Bar dataKey="amount" fill="hsl(var(--chart-1))" radius={[0, 4, 4, 0]} barSize={13}>
                  <LabelList dataKey="amount" position="right" formatter={(value: number) => `PHP ${Math.round(Number(value) / 1000)}K`} style={{ fontSize: 10, fontWeight: 700, fill: "hsl(var(--primary))" }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyPanel>No category sales data yet.</EmptyPanel>}
        </div>
      </ChartCard>

      <ChartCard title="Reservation Status Distribution" action="Live data">
        <div className="flex min-h-[310px] flex-wrap items-center justify-center gap-4 p-4">
          {reservationStatus.length ? (
            <>
              <div className="relative h-48 min-w-44 flex-1 basis-48 sm:h-52">
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
                    <p className="text-xs text-muted-foreground">Total</p>
                  </div>
                </div>
              </div>
              <div className="min-w-36 flex-1 basis-36 space-y-3">
                {reservationStatus.map((status) => (
                  <div key={status.name} className="grid grid-cols-[auto_1fr_auto] items-center gap-2 text-xs">
                    <span className="size-2.5 rounded-full" style={{ backgroundColor: status.color }} />
                    <span className="text-muted-foreground">{status.name}</span>
                    <span className="font-bold">{formatNumber(status.value)}</span>
                  </div>
                ))}
              </div>
            </>
          ) : <EmptyPanel>No reservation status data yet.</EmptyPanel>}
        </div>
      </ChartCard>
    </section>
  );
}
