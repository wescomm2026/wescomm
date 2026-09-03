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

const statusColors = ["#16803c", "#8cc665", "#f5b000", "#9aa3a8", "#00652f"];

function formatCurrency(value: number) {
  return `PHP ${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatNumber(value: number) {
  return value.toLocaleString("en-PH");
}

function ChartCard({ title, action, children }: { title: string; action: string; children: ReactNode }) {
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

export function StaffReportCharts({ summary }: { summary: BackendReportSummary }) {
  const reservationStatus = summary.reservationStatusDistribution.map((status, index) => ({
    name: status.label,
    value: status.value,
    color: statusColors[index % statusColors.length]
  }));
  const totalReservations = reservationStatus.reduce((total, status) => total + status.value, 0);

  return (
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
          ) : <EmptyPanel>No sales trend data yet.</EmptyPanel>}
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
          ) : <EmptyPanel>No category sales data yet.</EmptyPanel>}
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
          ) : <EmptyPanel>No reservation status data yet.</EmptyPanel>}
        </div>
      </ChartCard>
    </section>
  );
}
