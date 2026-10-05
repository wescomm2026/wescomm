import { Router } from "express";
import { z } from "zod";
import { REPORT_RANGE_PRESETS } from "../domain/report-range.js";
import { REPORT_BASES } from "../domain/report-insights.js";
import {
  SALES_REPORT_CHANNELS,
  SALES_REPORT_LOCATIONS,
  SALES_REPORT_PERIODS,
  addSalesLedgerDays,
  salesReportDateKey
} from "../domain/sales-ledger.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { requireRole } from "../middleware/require-role.js";
import { getReportSummary } from "../services/report.service.js";
import { buildReportSummaryWorkbook, reportSummaryFileName } from "../services/report-summary-excel.service.js";
import {
  buildSalesLedgerReport,
  type SalesLedgerReport
} from "../services/sales-ledger.service.js";
import {
  buildSalesLedgerWorkbook,
  salesLedgerFileLabel,
  salesLedgerFileName
} from "../services/sales-ledger-excel.service.js";
import { safelyRecordAuditLog } from "../services/audit-log.service.js";
import { asyncHandler } from "../utils/async-handler.js";
import { measureRequestPhase } from "../middleware/request-timing.js";

export const reportsRoutes = Router();

reportsRoutes.use(requireAuth, requireRole("STAFF", "ADMIN"));

const reportSummaryQuerySchema = z.object({
  preset: z.enum(REPORT_RANGE_PRESETS).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  granularity: z.enum(["AUTO", "DAILY", "MONTHLY"]).optional(),
  collectionChannel: z.enum(["COMMISSARY", "TREASURER"] as const).optional(),
  categoryId: z.string().uuid().optional(),
  basis: z.enum(REPORT_BASES).optional(),
  fresh: z.literal("1").optional()
});

reportsRoutes.get(
  "/summary",
  asyncHandler(async (request, response) => {
    const query = reportSummaryQuerySchema.parse(request.query);
    const { fresh, ...range } = query;
    const summary = await measureRequestPhase(response, "report_aggregate", () => getReportSummary(range, { bypassCache: fresh === "1" }));
    response.setHeader("Cache-Control", fresh === "1" ? "private, no-store, max-age=0" : "private, max-age=15, stale-while-revalidate=15");
    response.json({ summary });
  })
);

reportsRoutes.get(
  "/summary/download",
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const query = reportSummaryQuerySchema.parse(request.query);
    const { fresh: _fresh, ...range } = query;
    const summary = await measureRequestPhase(response, "report_aggregate", () =>
      getReportSummary(range, { bypassCache: true })
    );
    const workbook = buildReportSummaryWorkbook(summary);
    const buffer = await workbook.xlsx.writeBuffer();
    const fileName = reportSummaryFileName(summary);

    await safelyRecordAuditLog({
      actorId: request.auth!.id,
      action: "MANAGEMENT_REPORT_EXPORTED",
      entityType: "management_report",
      entityId: null,
      summary: `Exported the WESCOMM management analytics workbook as ${fileName}.`,
      metadata: {
        preset: summary.range.preset,
        from: summary.range.from,
        to: summary.range.to,
        basis: summary.reportBasis,
        collectionChannel: summary.filters.collectionChannel,
        fileName
      }
    });

    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="wescomm-management-analytics.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`
    );
    response.send(Buffer.from(buffer));
  })
);

const salesLedgerQuerySchema = z.object({
  period: z.enum(SALES_REPORT_PERIODS).default("DAILY"),
  anchor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  channel: z.enum(SALES_REPORT_CHANNELS).default("ALL"),
  collectionLocation: z.enum(SALES_REPORT_LOCATIONS).default("ALL"),
  snapshotAt: z.string().datetime({ offset: true }).optional()
});

function salesLedgerAuditMetadata(
  request: AuthenticatedRequest,
  report: SalesLedgerReport,
  fileName: string | null
) {
  return {
    period: report.range.period,
    anchor: report.range.anchor,
    channel: report.filters.channel,
    collectionLocation: report.filters.collectionLocation,
    snapshotAt: report.generatedAt,
    generatedBy: report.generatedBy ?? null,
    fileName
  };
}

reportsRoutes.get(
  "/sales-ledger",
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const query = salesLedgerQuerySchema.parse(request.query);
    const report = await measureRequestPhase(response, "sales_ledger_query", () =>
      buildSalesLedgerReport({
        period: query.period,
        anchor: query.anchor ?? salesReportDateKey(new Date()),
        channel: query.channel,
        collectionLocation: query.collectionLocation,
        snapshotAt: query.snapshotAt
      }, request.auth!.profile.fullName || request.auth!.profile.email)
    );
    response.setHeader("Cache-Control", "no-store");
    response.json(report);
  })
);

reportsRoutes.get(
  "/sales-ledger/download",
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const query = salesLedgerQuerySchema.parse(request.query);
    const report = await measureRequestPhase(response, "sales_ledger_query", () =>
      buildSalesLedgerReport({
        period: query.period,
        anchor: query.anchor ?? salesReportDateKey(new Date()),
        channel: query.channel,
        collectionLocation: query.collectionLocation,
        snapshotAt: query.snapshotAt
      }, request.auth!.profile.fullName || request.auth!.profile.email)
    );
    const fileName = salesLedgerFileName(report);

    const analyticsSummary = await measureRequestPhase(response, "sales_ledger_analytics", () =>
      getReportSummary({
        preset: "CUSTOM",
        from: report.range.fromKey,
        to: addSalesLedgerDays(report.range.toKey, -1),
        ...(report.filters.collectionLocation === "ALL" ? {} : { collectionChannel: report.filters.collectionLocation })
      }, { bypassCache: true })
    );
    const workbook = buildSalesLedgerWorkbook(report, {
      inventoryPlanning: analyticsSummary.inventoryPlanning.map((item) => ({
        item: item.item,
        category: item.category,
        status: item.status,
        stock: item.stock,
        unitsSold: item.unitsSold,
        stockCoverDays: item.stockCoverDays,
        suggestedReorderQuantity: item.suggestedReorderQuantity,
        recommendation: item.recommendation
      })),
      reconciliation: analyticsSummary.reconciliation.items.map((item) => ({
        severity: item.severity,
        label: item.label,
        referenceCode: item.referenceCode,
        eventAt: item.eventAt,
        amount: item.amount,
        paymentId: item.paymentId,
        receiptId: item.receiptId
      }))
    });
    const buffer = await workbook.xlsx.writeBuffer();

    await safelyRecordAuditLog({
      actorId: request.auth!.id,
      action: "SALES_REPORT_EXPORTED",
      entityType: "sales_report",
      entityId: null,
      summary: `Exported ${salesLedgerFileLabel(report)} as ${fileName}.`,
      metadata: salesLedgerAuditMetadata(request, report, fileName)
    });

    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="wescomm-sales-report.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`
    );
    response.send(Buffer.from(buffer));
  })
);

reportsRoutes.post(
  "/sales-ledger/audit",
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const input = z.object({
      action: z.enum(["PRINTED"]),
      period: z.enum(SALES_REPORT_PERIODS),
      anchor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      channel: z.enum(SALES_REPORT_CHANNELS),
      collectionLocation: z.enum(SALES_REPORT_LOCATIONS),
      snapshotAt: z.string().datetime({ offset: true }).optional()
    }).parse(request.body);

    await safelyRecordAuditLog({
      actorId: request.auth!.id,
      action: "SALES_REPORT_PRINTED",
      entityType: "sales_report",
      entityId: null,
      summary: `Printed the ${input.period.toLowerCase()} sales report for ${input.anchor}.`,
      metadata: {
        period: input.period,
        anchor: input.anchor,
        channel: input.channel,
        collectionLocation: input.collectionLocation,
        snapshotAt: input.snapshotAt ?? null
      }
    });

    response.setHeader("Cache-Control", "no-store");
    response.status(204).end();
  })
);
