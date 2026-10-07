"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
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

function ChartPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border bg-card shadow-soft">
      <div className="flex min-h-14 items-center border-b px-4 sm:px-5">
        <h2 className="font-extrabold text-foreground">{title}</h2>
      </div>
      {children}
    </section>
  );
}

export function AdminSummaryCharts({ summary, embedded = false }: { summary: BackendReportSummary; embedded?: boolean }) {
  const primaryTrend = summary.reportBasis === "COLLECTION" ? summary.collectionTrend : summary.salesTrend;
  const primaryTrendLabel = summary.reportBasis === "COLLECTION" ? "Cash Collection Trend" : "Recognized Sales Trend";
  const totalStatus = summary.reservationStatusDistribution.reduce((total, item) => total + item.value, 0);
  const panels = (
    <>
      <ChartPanel title={primaryTrendLabel}>
        <div className="h-[310px] p-4">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={primaryTrend} margin={{ top: 10, right: 10, left: -12, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="hsl(var(--chart-grid))" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={(value) => `PHP ${Math.round(Number(value) / 1000)}K`} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip formatter={(value: number) => formatCurrency(value)} />
              <Line type="monotone" dataKey="sales" stroke="hsl(var(--chart-1))" strokeWidth={3} dot={{ r: 3, fill: "hsl(var(--chart-1))" }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </ChartPanel>

      <ChartPanel title="Reservation Status">
        <div className="flex min-h-[310px] flex-wrap items-center justify-center gap-4 p-4">
          <div className="relative h-48 min-w-44 flex-1 basis-48 sm:h-52">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={summary.reservationStatusDistribution} dataKey="value" nameKey="label" innerRadius={52} outerRadius={82} paddingAngle={1}>
                  {summary.reservationStatusDistribution.map((entry, index) => <Cell key={entry.status} fill={statusColors[index % statusColors.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
              <div>
                <p className="text-2xl font-extrabold text-primary">{totalStatus}</p>
                <p className="text-xs text-muted-foreground">Total</p>
              </div>
            </div>
          </div>
          <div className="min-w-36 flex-1 basis-36 space-y-3">
            {summary.reservationStatusDistribution.map((item, index) => (
              <div key={item.status} className="grid grid-cols-[auto_1fr_auto] items-center gap-2 text-xs">
                <span className="size-2.5 rounded-full" style={{ backgroundColor: statusColors[index % statusColors.length] }} />
                <span className="text-muted-foreground">{item.label}</span>
                <span className="font-bold">{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      </ChartPanel>
    </>
  );

  return embedded ? panels : <section className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">{panels}</section>;
}

export function AdminReportsCharts({ summary }: { summary: BackendReportSummary }) {
  const topCategories = [...summary.categorySales]
    .sort((left, right) => right.sales - left.sales || left.category.localeCompare(right.category))
    .slice(0, 3);

  return (
    <section id="reservation-status" className="scroll-mt-24 grid gap-5 xl:grid-cols-2 2xl:grid-cols-3">
      <ChartPanel title="Top Categories by Sales">
        <div className="h-[330px] p-4">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={topCategories} layout="vertical" margin={{ top: 5, right: 70, left: 10, bottom: 0 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="category" width={125} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip formatter={(value: number) => formatCurrency(value)} />
              <Bar dataKey="amount" fill="hsl(var(--chart-1))" radius={[0, 4, 4, 0]} barSize={16} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartPanel>
      <AdminSummaryCharts summary={summary} embedded />
    </section>
  );
}
