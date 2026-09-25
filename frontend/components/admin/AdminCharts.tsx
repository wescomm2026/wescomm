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

const statusColors = ["#16803c", "#8cc665", "#f5b000", "#9aa3a8", "#00652f"];

function formatCurrency(value: number) {
  return `PHP ${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function ChartPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border border-[#dce5dd] bg-white shadow-sm">
      <div className="flex min-h-14 items-center border-b border-[#e5ebe6] px-4">
        <h2 className="font-extrabold text-[#17211b]">{title}</h2>
      </div>
      {children}
    </section>
  );
}

export function AdminSummaryCharts({ summary, embedded = false }: { summary: BackendReportSummary; embedded?: boolean }) {
  const totalStatus = summary.reservationStatusDistribution.reduce((total, item) => total + item.value, 0);
  const panels = (
    <>
      <ChartPanel title="Sales Trend">
        <div className="h-[310px] p-4">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={summary.salesTrend} margin={{ top: 10, right: 10, left: -12, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#e5ebe6" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={(value) => `PHP ${Math.round(Number(value) / 1000)}K`} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip formatter={(value: number) => formatCurrency(value)} />
              <Line type="monotone" dataKey="sales" stroke="#08742f" strokeWidth={3} dot={{ r: 3, fill: "#08742f" }} />
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
                <p className="text-xs text-[#69746e]">Total</p>
              </div>
            </div>
          </div>
          <div className="min-w-36 flex-1 basis-36 space-y-3">
            {summary.reservationStatusDistribution.map((item, index) => (
              <div key={item.status} className="grid grid-cols-[auto_1fr_auto] items-center gap-2 text-xs">
                <span className="size-2.5 rounded-full" style={{ backgroundColor: statusColors[index % statusColors.length] }} />
                <span className="text-[#536058]">{item.label}</span>
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
    <section className="grid gap-5 xl:grid-cols-2 2xl:grid-cols-3">
      <ChartPanel title="Top Categories by Sales">
        <div className="h-[330px] p-4">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={topCategories} layout="vertical" margin={{ top: 5, right: 70, left: 10, bottom: 0 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="category" width={125} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip formatter={(value: number) => formatCurrency(value)} />
              <Bar dataKey="amount" fill="#16803c" radius={[0, 4, 4, 0]} barSize={16} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartPanel>
      <AdminSummaryCharts summary={summary} embedded />
    </section>
  );
}
