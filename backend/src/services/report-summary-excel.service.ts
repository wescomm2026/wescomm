import ExcelJS from "exceljs";
import type { getReportSummary } from "./report.service.js";

type ReportSummary = Awaited<ReturnType<typeof getReportSummary>>;

const GREEN = "FF006633";
const SOFT_GREEN = "FFEAF5EC";
const BORDER = "FFB8D7BF";
const TEXT = "FF17211B";
const MUTED = "FF5F6D66";
const STRIPE = "FFF3F8F4";
const PESO = '"₱"#,##0.00';
const PERCENT = "0.00%";
const DATE_TIME = "yyyy-mm-dd h:mm";

function setPage(worksheet: ExcelJS.Worksheet, headerRow: number, lastRow: number, lastColumn: number) {
  worksheet.pageSetup = {
    paperSize: 9,
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: `${headerRow}:${headerRow}`,
    printArea: `A1:${worksheet.getColumn(lastColumn).letter}${lastRow}`,
    horizontalCentered: true,
    margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.25, footer: 0.25 }
  };
  worksheet.headerFooter.oddHeader = '&C&"Aptos,Bold"&8WESCOMM MANAGEMENT ANALYTICS';
  worksheet.headerFooter.oddFooter = '&L&"Aptos,Regular"&8Internal management report&R&"Aptos,Bold"&8Page &P of &N  |  &D &T';
  worksheet.views = [{ state: "frozen", ySplit: headerRow, showGridLines: false, zoomScale: 90 }];
  worksheet.properties.defaultRowHeight = 15;
}

function title(worksheet: ExcelJS.Worksheet, reportTitle: string, summary: ReportSummary, columnCount: number) {
  worksheet.mergeCells(1, 1, 1, columnCount);
  const titleCell = worksheet.getCell(1, 1);
  titleCell.value = `WESCOMM — ${reportTitle}`;
  titleCell.font = { name: "Aptos", size: 15, bold: true, color: { argb: GREEN } };
  titleCell.alignment = { vertical: "middle" };
  worksheet.getRow(1).height = 23;

  worksheet.mergeCells(2, 1, 2, columnCount);
  const detailCell = worksheet.getCell(2, 1);
  detailCell.value = `${summary.range.label}  •  Basis: ${summary.reportBasis === "COLLECTION" ? "Cash collections" : "Completed reservations"}  •  Generated: ${new Date(summary.generatedAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}`;
  detailCell.font = { name: "Aptos", size: 9, color: { argb: MUTED } };
  worksheet.getRow(2).height = 18;
}

function headers(worksheet: ExcelJS.Worksheet, rowNumber: number, values: string[]) {
  const row = worksheet.getRow(rowNumber);
  row.values = values;
  row.height = 24;
  row.eachCell((cell) => {
    cell.font = { name: "Aptos", size: 9, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN } };
    cell.alignment = { vertical: "middle", wrapText: true };
    cell.border = {
      top: { style: "thin", color: { argb: BORDER } },
      left: { style: "thin", color: { argb: BORDER } },
      bottom: { style: "thin", color: { argb: BORDER } },
      right: { style: "thin", color: { argb: BORDER } }
    };
  });
}

function bodyRow(worksheet: ExcelJS.Worksheet, rowNumber: number) {
  worksheet.getRow(rowNumber).eachCell((cell) => {
    cell.font = { name: "Aptos", size: 9, color: { argb: TEXT } };
    cell.alignment = { vertical: "top", wrapText: true };
    cell.border = { bottom: { style: "thin", color: { argb: "FFE2E9E3" } } };
    if (rowNumber % 2 === 0) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: STRIPE } };
  });
}

function finishTable(worksheet: ExcelJS.Worksheet, headerRow: number, lastRow: number, lastColumn: number) {
  worksheet.autoFilter = {
    from: { row: headerRow, column: 1 },
    to: { row: Math.max(headerRow, lastRow), column: lastColumn }
  };
  setPage(worksheet, headerRow, Math.max(headerRow, lastRow), lastColumn);
}

function addSummarySheet(workbook: ExcelJS.Workbook, summary: ReportSummary) {
  const worksheet = workbook.addWorksheet("Executive Summary");
  worksheet.columns = [{ width: 34 }, { width: 20 }, { width: 34 }, { width: 20 }];
  title(worksheet, "Management Analytics", summary, 4);
  headers(worksheet, 4, ["Financial Metric", "Value", "Operational Metric", "Value"]);
  const rows: Array<[string, number, string, number]> = [
    ["Total recognized sales", summary.totalSales, "Total reservations", summary.totalReservations],
    ["Cost of goods sold", summary.cogs, "Pending reservations", summary.pendingReservations],
    ["Gross profit", summary.grossProfit, "Products", summary.totalProducts],
    ["Commissary collections", summary.commissaryCollection, "Low-stock items", summary.lowStockItems],
    ["Treasury collections", summary.treasurerCollection, "Out-of-stock items", summary.outOfStockItems],
    ["Walk-in sales", summary.walkInSales.amount, "Walk-in receipts", summary.walkInSales.receipts],
    ["Walk-in voids", summary.walkInVoids.amount, "Walk-in void count", summary.walkInVoids.count],
    ["Inventory value", summary.inventoryValue, "Reconciliation exceptions", summary.reconciliation.exceptionCount]
  ];
  rows.forEach((values, index) => {
    const rowNumber = index + 5;
    worksheet.getRow(rowNumber).values = values;
    bodyRow(worksheet, rowNumber);
    worksheet.getCell(rowNumber, 2).numFmt = PESO;
    worksheet.getCell(rowNumber, 4).numFmt = "#,##0";
  });
  worksheet.getCell(11, 4).numFmt = "#,##0";
  finishTable(worksheet, 4, 4 + rows.length, 4);
}

function addSalesTrendSheet(workbook: ExcelJS.Workbook, summary: ReportSummary) {
  const worksheet = workbook.addWorksheet("Sales Trend");
  worksheet.columns = [{ width: 18 }, { width: 24 }, { width: 18 }, { width: 16 }];
  title(worksheet, "Sales Trend", summary, 4);
  headers(worksheet, 4, ["Period Key", "Period", "Recognized Sales", "Receipts"]);
  summary.salesTrend.forEach((item, index) => {
    const rowNumber = index + 5;
    worksheet.getRow(rowNumber).values = [item.key, item.day, item.sales, item.receipts];
    bodyRow(worksheet, rowNumber);
    worksheet.getCell(rowNumber, 3).numFmt = PESO;
    worksheet.getCell(rowNumber, 4).numFmt = "#,##0";
  });
  finishTable(worksheet, 4, 4 + summary.salesTrend.length, 4);
}

function addProductsSheet(workbook: ExcelJS.Workbook, summary: ReportSummary) {
  const worksheet = workbook.addWorksheet("Products & Margin");
  worksheet.columns = [{ width: 30 }, { width: 20 }, { width: 14 }, { width: 17 }, { width: 17 }, { width: 17 }, { width: 14 }];
  title(worksheet, "Products and Margin", summary, 7);
  headers(worksheet, 4, ["Item", "Category", "Quantity Sold", "Sales", "COGS", "Gross Profit", "Margin"]);
  summary.itemSales.forEach((item, index) => {
    const rowNumber = index + 5;
    worksheet.getRow(rowNumber).values = [item.item, item.category, item.quantity, item.sales, item.cogs, item.grossProfit, item.marginPercent === null ? null : item.marginPercent / 100];
    bodyRow(worksheet, rowNumber);
    [4, 5, 6].forEach((column) => { worksheet.getCell(rowNumber, column).numFmt = PESO; });
    worksheet.getCell(rowNumber, 7).numFmt = PERCENT;
  });
  finishTable(worksheet, 4, 4 + summary.itemSales.length, 7);
}

function addInventorySheet(workbook: ExcelJS.Workbook, summary: ReportSummary) {
  const worksheet = workbook.addWorksheet("Inventory Actions");
  worksheet.columns = [{ width: 28 }, { width: 18 }, { width: 16 }, { width: 11 }, { width: 13 }, { width: 15 }, { width: 17 }, { width: 52 }];
  title(worksheet, "Inventory Actions", summary, 8);
  headers(worksheet, 4, ["Item", "Category", "Status", "Stock", "Units Sold", "Stock Cover Days", "Suggested Reorder", "Recommended Action"]);
  summary.inventoryPlanning.forEach((item, index) => {
    const rowNumber = index + 5;
    worksheet.getRow(rowNumber).values = [item.item, item.category, item.status.replaceAll("_", " "), item.stock, item.unitsSold, item.stockCoverDays, item.suggestedReorderQuantity, item.recommendation];
    bodyRow(worksheet, rowNumber);
    [4, 5, 6, 7].forEach((column) => { worksheet.getCell(rowNumber, column).numFmt = "#,##0.00"; });
  });
  finishTable(worksheet, 4, 4 + summary.inventoryPlanning.length, 8);
}

function addReconciliationSheet(workbook: ExcelJS.Workbook, summary: ReportSummary) {
  const worksheet = workbook.addWorksheet("Reconciliation");
  worksheet.columns = [{ width: 12 }, { width: 38 }, { width: 20 }, { width: 19 }, { width: 16 }, { width: 38 }];
  title(worksheet, "Reconciliation Exceptions", summary, 6);
  headers(worksheet, 4, ["Priority", "Issue", "Reference", "Event Date/Time", "Amount", "Receipt / Payment ID"]);
  summary.reconciliation.items.forEach((item, index) => {
    const rowNumber = index + 5;
    worksheet.getRow(rowNumber).values = [item.severity, item.label, item.referenceCode, new Date(item.eventAt), item.amount, item.receiptId ?? item.paymentId ?? "—"];
    bodyRow(worksheet, rowNumber);
    worksheet.getCell(rowNumber, 4).numFmt = DATE_TIME;
    worksheet.getCell(rowNumber, 5).numFmt = PESO;
  });
  finishTable(worksheet, 4, 4 + summary.reconciliation.items.length, 6);
}

function addCashierSheet(workbook: ExcelJS.Workbook, summary: ReportSummary) {
  const worksheet = workbook.addWorksheet("Cashier Reconciliation");
  worksheet.columns = [{ width: 30 }, { width: 16 }, { width: 18 }, { width: 15 }, { width: 18 }, { width: 18 }];
  title(worksheet, "Cashier Reconciliation", summary, 6);
  headers(worksheet, 4, ["Cashier", "Sale Count", "Gross Sales", "Void Count", "Voids", "Expected Net Cash"]);
  summary.cashierReconciliation.forEach((item, index) => {
    const rowNumber = index + 5;
    worksheet.getRow(rowNumber).values = [item.cashierName, item.saleCount, item.sales, item.voidCount, item.voids, item.sales - item.voids];
    bodyRow(worksheet, rowNumber);
    [3, 5, 6].forEach((column) => { worksheet.getCell(rowNumber, column).numFmt = PESO; });
  });
  finishTable(worksheet, 4, 4 + summary.cashierReconciliation.length, 6);
}

function addTreasurySheet(workbook: ExcelJS.Workbook, summary: ReportSummary) {
  const worksheet = workbook.addWorksheet("Treasury Collections");
  worksheet.columns = [{ width: 19 }, { width: 22 }, { width: 21 }, { width: 42 }, { width: 18 }];
  title(worksheet, "Treasury Collections", summary, 5);
  headers(worksheet, 4, ["Paid Date/Time", "Official Receipt No.", "Order Reference", "Items", "Amount"]);
  summary.treasurerCollections.forEach((item, index) => {
    const rowNumber = index + 5;
    worksheet.getRow(rowNumber).values = [new Date(item.paidAt), item.officialReceiptNumber ?? "—", item.orderReference, item.items, item.amount];
    bodyRow(worksheet, rowNumber);
    worksheet.getCell(rowNumber, 1).numFmt = DATE_TIME;
    worksheet.getCell(rowNumber, 5).numFmt = PESO;
  });
  finishTable(worksheet, 4, 4 + summary.treasurerCollections.length, 5);
}

export function buildReportSummaryWorkbook(summary: ReportSummary) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "WESCOMM";
  workbook.company = "Wesleyan University-Philippines";
  workbook.created = new Date(summary.generatedAt);
  workbook.modified = new Date(summary.generatedAt);
  addSummarySheet(workbook, summary);
  addSalesTrendSheet(workbook, summary);
  addProductsSheet(workbook, summary);
  addInventorySheet(workbook, summary);
  addReconciliationSheet(workbook, summary);
  addCashierSheet(workbook, summary);
  addTreasurySheet(workbook, summary);
  return workbook;
}

export function reportSummaryFileName(summary: ReportSummary) {
  const rangeLabel = `${summary.range.from ?? "all-time"}-${summary.range.to}`;
  return `wescomm-management-analytics-${rangeLabel}.xlsx`;
}
