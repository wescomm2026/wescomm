import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../utils/http-error.js";
import {
  resolveSalesLedgerRange,
  MAX_SALES_LEDGER_RECEIPTS
} from "../domain/sales-ledger.js";
import {
  buildProductSummary,
  buildSalesLedgerReport,
  buildSummary,
  mapSaleRows,
  type SalesLedgerReport,
  type SalesLedgerSaleRow,
  type SalesLedgerVoidRow
} from "../services/sales-ledger.service.js";
import {
  buildSalesLedgerWorkbook,
  salesLedgerFileName
} from "../services/sales-ledger-excel.service.js";
import {
  buildReportSummaryWorkbook,
  reportSummaryFileName
} from "../services/report-summary-excel.service.js";
import { EXCEL_DATETIME_FORMAT } from "../utils/excel-dates.js";

const PESO_NUM_FMT = '"\u20b1"#,##0.00';

test("daily range uses exclusive Manila midnight boundaries", () => {
  const range = resolveSalesLedgerRange({ period: "DAILY", anchor: "2026-10-01", now: "2026-10-02T08:00:00Z" });
  assert.equal(range.fromKey, "2026-10-01");
  assert.equal(range.toKey, "2026-10-02");
  assert.equal(range.fromInclusive.toISOString(), "2026-09-30T16:00:00.000Z");
  assert.equal(range.toExclusive.toISOString(), "2026-10-01T16:00:00.000Z");
  assert.equal(range.label, "October 1, 2026");
});

test("weekly range covers Monday to Sunday of the anchor week", () => {
  for (const anchor of ["2026-09-28", "2026-10-01", "2026-10-04"]) {
    const range = resolveSalesLedgerRange({ period: "WEEKLY", anchor, now: "2026-10-05T08:00:00Z" });
    assert.equal(range.fromKey, "2026-09-28", `anchor ${anchor}`);
    assert.equal(range.toKey, "2026-10-05", `anchor ${anchor}`);
    assert.equal(range.fromInclusive.toISOString(), "2026-09-27T16:00:00.000Z");
    assert.equal(range.toExclusive.toISOString(), "2026-10-04T16:00:00.000Z");
    assert.equal(range.label, "Sep 28 \u2013 Oct 4, 2026");
  }
});

test("weekly range spans year boundary when the Monday falls in December", () => {
  const range = resolveSalesLedgerRange({ period: "WEEKLY", anchor: "2026-01-01", now: "2026-02-01T08:00:00Z" });
  assert.equal(range.fromKey, "2025-12-29");
  assert.equal(range.toKey, "2026-01-05");
});

test("monthly range covers first through last day including leap February", () => {
  const leap = resolveSalesLedgerRange({ period: "MONTHLY", anchor: "2028-02-29", now: "2028-03-01T08:00:00Z" });
  assert.equal(leap.fromKey, "2028-02-01");
  assert.equal(leap.toKey, "2028-03-01");
  assert.equal(leap.fromInclusive.toISOString(), "2028-01-31T16:00:00.000Z");
  assert.equal(leap.toExclusive.toISOString(), "2028-02-29T16:00:00.000Z");
  assert.equal(leap.label, "February 2028");

  const common = resolveSalesLedgerRange({ period: "MONTHLY", anchor: "2026-02-14", now: "2026-03-01T08:00:00Z" });
  assert.equal(common.fromKey, "2026-02-01");
  assert.equal(common.toKey, "2026-03-01");

  const december = resolveSalesLedgerRange({ period: "MONTHLY", anchor: "2025-12-15", now: "2025-12-20T08:00:00Z" });
  assert.equal(december.fromKey, "2025-12-01");
  assert.equal(december.toKey, "2026-01-01");
});

test("month-end daily range rolls into the next month exclusively", () => {
  const range = resolveSalesLedgerRange({ period: "DAILY", anchor: "2026-10-31", now: "2026-10-31T20:00:00Z" });
  assert.equal(range.toKey, "2026-11-01");
  assert.equal(range.toExclusive.toISOString(), "2026-10-31T16:00:00.000Z");
});

test("future anchors and malformed dates are rejected", () => {
  assert.throws(
    () => resolveSalesLedgerRange({ period: "DAILY", anchor: "2027-01-01", now: "2026-10-02T00:00:00Z" }),
    (error: unknown) => error instanceof HttpError && error.status === 400 && error.code === "INVALID_SALES_REPORT_RANGE"
  );
  for (const anchor of ["2026-02-30", "2026-13-01", "not-a-date"]) {
    assert.throws(
      () => resolveSalesLedgerRange({ period: "DAILY", anchor }),
      (error: unknown) => error instanceof HttpError && error.status === 400 && error.code === "INVALID_SALES_REPORT_RANGE"
    );
  }
});

type FakeReceipt = {
  receiptCode: string;
  issuedAt: Date;
  verifiedAt?: Date | null;
  totalAmount: number;
  student: { fullName: string; studentNumber: string | null };
  issuedBy?: { fullName: string } | null;
  walkInSale?: { cashierNameSnapshot: string } | null;
  walkInSaleItems?: Array<{
    productId: string;
    productNameSnapshot: string;
    optionSnapshot: unknown;
    quantity: number;
    unitPrice: number;
    subtotal: number;
    costAllocations: Array<{ quantity: number; unitCost: number }>;
  }>;
  reservation?: {
    referenceCode: string;
    collectionPayment: { paidAt: Date; collectionChannel: "COMMISSARY" | "TREASURER" } | null;
    items: Array<{
      productId: string;
      productNameSnapshot: string;
      skuCodeSnapshot: string | null;
      optionSnapshot: unknown;
      variantSummary: string | null;
      categoryNameSnapshot: string | null;
      quantity: number;
      unitPrice: number;
      subtotal: number;
      costAllocations: Array<{ quantity: number; unitCost: number }>;
    }>;
  } | null;
};

function fakeReceipts(): FakeReceipt[] {
  return [
    {
      receiptCode: "WIS-0001",
      issuedAt: new Date("2026-10-01T02:30:00+08:00"),
      totalAmount: 450,
      student: { fullName: "Ana Reyes", studentNumber: "2024-00123" },
      issuedBy: { fullName: "Carlo Santos" },
      walkInSale: { cashierNameSnapshot: "Carlo Santos" },
      walkInSaleItems: [
        {
          productId: "p1",
          productNameSnapshot: "ID Lace",
          optionSnapshot: [{ optionName: "Color", optionValue: "Blue" }],
          quantity: 1,
          unitPrice: 450,
          subtotal: 450,
          costAllocations: [{ quantity: 1, unitCost: 200 }]
        }
      ],
      reservation: null
    },
    {
      receiptCode: "RES-0001",
      issuedAt: new Date("2026-10-01T03:00:00+08:00"),
      verifiedAt: new Date("2026-10-01T03:05:00+08:00"),
      totalAmount: 1600,
      student: { fullName: "Ben Cruz", studentNumber: null },
      issuedBy: { fullName: "Carlo Santos" },
      walkInSale: null,
      walkInSaleItems: [],
      reservation: {
        referenceCode: "WUP-2026-00042",
        collectionPayment: { paidAt: new Date("2026-10-01T04:00:00+08:00"), collectionChannel: "TREASURER" },
        items: [
          {
            productId: "p2",
            productNameSnapshot: "PE Shirt",
            skuCodeSnapshot: "PE-S-M",
            optionSnapshot: [{ optionName: "Size", optionValue: "Medium" }],
            variantSummary: "Medium",
            categoryNameSnapshot: "PE Uniforms",
            quantity: 2,
            unitPrice: 800,
            subtotal: 1600,
            costAllocations: [{ quantity: 2, unitCost: 500 }]
          }
        ]
      }
    },
    {
      receiptCode: "RES-0002",
      issuedAt: new Date("2026-10-01T01:00:00+08:00"),
      verifiedAt: new Date("2026-10-01T01:02:00+08:00"),
      totalAmount: 500,
      student: { fullName: "Cora Diaz", studentNumber: "2023-00555" },
      issuedBy: { fullName: "Dina Lim" },
      walkInSale: null,
      walkInSaleItems: [],
      reservation: {
        referenceCode: "WUP-2026-00043",
        collectionPayment: { paidAt: new Date("2026-10-01T01:30:00+08:00"), collectionChannel: "COMMISSARY" },
        items: [
          {
            productId: "p3",
            productNameSnapshot: "WESCOMM Umbrella",
            skuCodeSnapshot: null,
            optionSnapshot: [],
            variantSummary: null,
            categoryNameSnapshot: "Other Items",
            quantity: 1,
            unitPrice: 500,
            subtotal: 500,
            costAllocations: [{ quantity: 1, unitCost: 300 }]
          }
        ]
      }
    }
  ];
}

test("sale rows map reservation and walk-in receipts with chronological ordering", () => {
  const rows = mapSaleRows(fakeReceipts() as never);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((row) => row.sequence), [1, 2, 3]);
  assert.deepEqual(rows.map((row) => row.receiptCode), ["RES-0002", "WIS-0001", "RES-0001"]);

  const walkIn = rows.find((row) => row.type === "WALK_IN")!;
  assert.equal(walkIn.collectionPoint, "COMMISSARY");
  assert.equal(walkIn.cashierName, "Carlo Santos");
  assert.equal(walkIn.orderReference, null);
  assert.deepEqual(walkIn.itemLines, ["1\u00d7 ID Lace \u2014 Blue"]);

  const treasury = rows.find((row) => row.receiptCode === "RES-0001")!;
  assert.equal(treasury.type, "RESERVATION");
  assert.equal(treasury.collectionPoint, "TREASURER");
  assert.equal(treasury.orderReference, "WUP-2026-00042");
  assert.equal(treasury.studentNumber, null);
  assert.deepEqual(treasury.itemLines, ["2\u00d7 PE Shirt \u2014 Medium"]);
  assert.equal(treasury.timestamp, "2026-09-30T20:00:00.000Z");

  const commissary = rows.find((row) => row.receiptCode === "RES-0002")!;
  assert.deepEqual(commissary.itemLines, ["1\u00d7 WESCOMM Umbrella"]);
});

test("summary totals count units and keep voids separate from recognized sales", () => {
  const sales = mapSaleRows(fakeReceipts() as never);
  const voids: SalesLedgerVoidRow[] = [
    { voidedAt: "2026-09-30T18:00:00.000Z", originalSaleAt: "2026-09-30T17:00:00.000Z", receiptCode: "WIS-0000", type: "WALK_IN", amount: 300, cashierName: "Carlo Santos", voidedBy: "Carlo Santos", reason: "Wrong item" }
  ];
  const summary = buildSummary(sales, voids);
  assert.equal(summary.validSalesTransactions, 3);
  assert.equal(summary.totalUnitsSold, 4);
  assert.equal(summary.reservationSales.count, 2);
  assert.equal(summary.reservationSales.amount, 2100);
  assert.equal(summary.walkInSales.count, 1);
  assert.equal(summary.walkInSales.amount, 450);
  assert.equal(summary.totalRecognizedSales, 2550);
  assert.equal(summary.voidsProcessed.count, 1);
  assert.equal(summary.voidsProcessed.amount, 300);
});

test("product summary aggregates quantities, sales, and FIFO COGS per variant", () => {
  const sales = mapSaleRows(fakeReceipts() as never);
  const rows = buildProductSummary(sales);
  assert.equal(rows.length, 3);

  const shirt = rows.find((row) => row.item === "PE Shirt")!;
  assert.equal(shirt.category, "PE Uniforms");
  assert.equal(shirt.skuOrOption, "PE-S-M \u2014 Medium");
  assert.equal(shirt.quantity, 2);
  assert.equal(shirt.sales, 1600);
  assert.equal(shirt.cogs, 1000);
  assert.equal(shirt.grossProfit, 600);

  const lace = rows.find((row) => row.item === "ID Lace")!;
  assert.equal(lace.skuOrOption, "Blue");
  assert.equal(lace.cogs, 200);
  assert.equal(lace.grossProfit, 250);

  assert.equal(rows.reduce((total, row) => total + row.sales, 0), 2550);
});

function reportFixture(sales: SalesLedgerSaleRow[], voids: SalesLedgerVoidRow[]): SalesLedgerReport {
  return {
    generatedAt: "2026-10-02T03:00:00.000Z",
    generatedBy: "Carlo Santos",
    range: {
      period: "DAILY",
      anchor: "2026-10-01",
      fromKey: "2026-10-01",
      toKey: "2026-10-02",
      fromInclusive: "2026-09-30T16:00:00.000Z",
      toExclusive: "2026-10-01T16:00:00.000Z",
      label: "October 1, 2026"
    },
    filters: { channel: "ALL", collectionLocation: "ALL" },
    summary: buildSummary(sales, voids),
    sales,
    voids,
    productSummary: buildProductSummary(sales)
  };
}

function withSequences(rows: SalesLedgerSaleRow[]) {
  return rows.map((row, index) => ({ ...row, sequence: index + 1 }));
}

test("excel workbook carries print-ready page setup and repeated header rows", () => {
  const report = reportFixture(withSequences(mapSaleRows(fakeReceipts() as never)), []);
  const workbook = buildSalesLedgerWorkbook(report);

  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ["Sales Report", "Product Summary", "Voids", "Inventory Planning", "Reconciliation"]);

  for (const sheet of workbook.worksheets) {
    assert.equal(sheet.pageSetup.orientation, "landscape");
    assert.equal(sheet.pageSetup.paperSize, 9);
    assert.equal(sheet.pageSetup.fitToPage, true);
    assert.equal(sheet.pageSetup.fitToWidth, 1);
    assert.equal(sheet.pageSetup.fitToHeight, 0, `${sheet.name} must not force one-page height`);
    assert.match(sheet.pageSetup.printTitlesRow ?? "", /^\d+:\d+$/);
    assert.match(sheet.pageSetup.printArea ?? "", /^A1:[A-Z]+\d+$/, `${sheet.name} must define an explicit print area`);
    assert.match(String(sheet.headerFooter.oddFooter ?? ""), /Page &P of &N/);
    assert.ok(sheet.autoFilter);
    assert.equal(sheet.views[0]?.state, "frozen");
    assert.ok(sheet.views[0]?.ySplit && sheet.views[0].ySplit > 0);
    assert.equal(sheet.views[0]?.showGridLines, false);
  }

  const main = workbook.getWorksheet("Sales Report")!;
  assert.equal(main.getCell("A4").value, "Reporting period");
  assert.equal(main.getCell("A4").isMerged, true, "metadata labels must span columns instead of clipping in the sequence column");
  assert.equal(main.getCell("C4").value, report.range.label);
  assert.equal(main.getCell("A7").value, "Summary");
  const richText = (address: string) => (main.getCell(address).value as { richText: Array<{ text: string }> }).richText.map((part) => part.text).join("");
  assert.match(richText("A8"), /Transactions/);
  assert.match(richText("F8"), /Reservation sales/);
  assert.match(richText("A9"), /Total recognized sales/);
  assert.match(richText("I9"), /Void amount/);

  // Excel has no time zones: datetimes must be written as Manila wall-clock time.
  const firstSale = report.sales[0];
  const saleCell = main.getCell(12, 2); // header row 11: title (1-6), summary (7-9), blank (10)
  const expectedWallClock = new Date(new Date(firstSale.timestamp).getTime() + 8 * 60 * 60 * 1000);
  assert.equal((saleCell.value as Date).toISOString(), expectedWallClock.toISOString());

  const products = workbook.getWorksheet("Product Summary")!;
  const totalRow = 5 + report.productSummary.length;
  assert.equal(products.getCell(totalRow, 1).value, "Total");
  assert.equal(products.getCell(totalRow, 5).value, report.productSummary.reduce((sum, row) => sum + row.sales, 0));
});

test("sales ledger rejects a future snapshot before querying report data", async () => {
  await assert.rejects(
    () => buildSalesLedgerReport({
      period: "DAILY",
      anchor: "2026-10-01",
      channel: "ALL",
      collectionLocation: "ALL",
      snapshotAt: "2099-01-01T00:00:00.000Z"
    }),
    (error: unknown) => error instanceof HttpError && error.code === "INVALID_REPORT_SNAPSHOT"
  );
});

test("management analytics workbook is native xlsx with printable operational sheets", async () => {
  const summary = {
    generatedAt: "2026-10-02T03:00:00.000Z",
    range: { preset: "LAST_7_DAYS", from: "2026-09-25", to: "2026-10-01", granularity: "DAILY", label: "Sep 25 – Oct 1, 2026" },
    filters: { collectionChannel: "ALL", categoryId: null, basis: "COLLECTION" },
    reportBasis: "COLLECTION",
    totalSales: 2050,
    cogs: 1250,
    grossProfit: 800,
    commissaryCollection: 450,
    treasurerCollection: 1600,
    walkInSales: { amount: 450, receipts: 1, cogs: 250 },
    walkInVoids: { count: 1, amount: 300 },
    totalReservations: 1,
    pendingReservations: 0,
    totalProducts: 2,
    lowStockItems: 1,
    outOfStockItems: 0,
    inventoryValue: 10000,
    salesTrend: [{ key: "2026-10-01", day: "Oct 1", sales: 2050, receipts: 2 }],
    itemSales: [{ productId: "p1", item: "PE Shirt", category: "Uniform", quantity: 2, sales: 1600, cogs: 1000, grossProfit: 600, marginPercent: 37.5 }],
    inventoryPlanning: [{ productId: "p1", item: "PE Shirt", category: "Uniform", status: "REORDER", stock: 3, lowStockThreshold: 5, unitsSold: 2, sales: 1600, cogs: 1000, grossProfit: 600, marginPercent: 37.5, stockCoverDays: 10, suggestedReorderQuantity: 7, recommendation: "Reorder 7 units.", lastSoldAt: "2026-10-01T03:00:00.000Z" }],
    reconciliation: { status: "CLEAN", exceptionCount: 0, amountAtRisk: 0, truncated: false, counts: {}, items: [] },
    cashierReconciliation: [{ cashierId: "u1", cashierName: "QA Staff", saleCount: 1, sales: 450, voidCount: 0, voids: 0 }],
    treasurerCollections: [{ paymentId: "pay1", paidAt: "2026-10-01T03:00:00.000Z", officialReceiptNumber: "OR-1", orderReference: "WUP-1", items: "2× PE Shirt", amount: 1600 }]
  } as never;

  const workbook = buildReportSummaryWorkbook(summary);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), [
    "Executive Summary",
    "Sales Trend",
    "Products & Margin",
    "Inventory Actions",
    "Reconciliation",
    "Cashier Reconciliation",
    "Treasury Collections"
  ]);
  for (const sheet of workbook.worksheets) {
    assert.equal(sheet.pageSetup.orientation, "landscape");
    assert.equal(sheet.pageSetup.fitToWidth, 1);
    assert.equal(sheet.pageSetup.fitToHeight, 0);
    assert.match(sheet.pageSetup.printArea ?? "", /^A1:[A-Z]+\d+$/);
    assert.match(String(sheet.headerFooter.oddFooter ?? ""), /Page &P of &N/);
  }
  assert.equal(workbook.getWorksheet("Products & Margin")!.getCell("D5").value, 1600);
  assert.equal(workbook.getWorksheet("Products & Margin")!.getCell("D5").numFmt, PESO_NUM_FMT);
  assert.equal(reportSummaryFileName(summary), "wescomm-management-analytics-2026-09-25-2026-10-01.xlsx");
  const serialized = await workbook.xlsx.writeBuffer();
  assert.ok(serialized.byteLength > 1_000, "the workbook must serialize as a non-empty xlsx package");
});

test("workbook includes voids with original sale date and analytics support sheets", () => {
  const sales = mapSaleRows(fakeReceipts() as never);
  const voids: SalesLedgerVoidRow[] = [
    { voidedAt: "2026-09-30T19:00:00.000Z", originalSaleAt: "2026-09-30T17:00:00.000Z", receiptCode: "WIS-0000", type: "WALK_IN", amount: 300, cashierName: "Carlo Santos", voidedBy: "Carlo Santos", reason: "Wrong item" }
  ];
  const report = reportFixture(withSequences(sales), voids);
  const workbook = buildSalesLedgerWorkbook(report, {
    inventoryPlanning: [
      {
        item: "PE Shirt",
        category: "PE Uniforms",
        status: "REORDER",
        stock: 3,
        unitsSold: 2,
        stockCoverDays: 18,
        suggestedReorderQuantity: 7,
        recommendation: "Reorder 7 unit(s) to restore a practical stock buffer."
      }
    ],
    reconciliation: []
  });

  const voidsSheet = workbook.getWorksheet("Voids")!;
  const voidHeaders = Object.values(voidsSheet.getRow(4).values as object) as unknown[];
  assert.ok(voidHeaders.includes("Original Sale Date"), "voids sheet must carry the original sale date");
  assert.ok(voidHeaders.includes("Reason"));

  const planning = workbook.getWorksheet("Inventory Planning")!;
  const planningHeaders = Object.values(planning.getRow(4).values as object) as unknown[];
  assert.ok(planningHeaders.includes("Suggested Reorder"));
  assert.ok(planningHeaders.includes("Current Stock"));

  const reconciliation = workbook.getWorksheet("Reconciliation")!;
  let clearRow = false;
  reconciliation.eachRow((row) => {
    row.eachCell((cell) => {
      if (cell.value === "No reconciliation issues") clearRow = true;
    });
  });
  assert.ok(clearRow, "empty reconciliation must show a clear no-issues row");
});

test("excel cells use real numbers, peso formats, and real dates", () => {
  const report = reportFixture(withSequences(mapSaleRows(fakeReceipts() as never)), []);
  const workbook = buildSalesLedgerWorkbook(report);
  const main = workbook.getWorksheet("Sales Report")!;

  let pesoNumberCells = 0;
  let dateCells = 0;
  main.eachRow((row) => {
    row.eachCell((cell) => {
      if (cell.numFmt === PESO_NUM_FMT && typeof cell.value === "number") pesoNumberCells += 1;
      if (cell.value instanceof Date && cell.numFmt === EXCEL_DATETIME_FORMAT) dateCells += 1;
    });
  });
  assert.ok(pesoNumberCells >= 4, `expected peso-formatted numeric cells, found ${pesoNumberCells}`);
  assert.ok(dateCells >= 3, `expected real date cells, found ${dateCells}`);

  const grandTotalCells = main.getColumn(11).values as Array<unknown>;
  const numericGrandTotal = grandTotalCells.find((value) => typeof value === "number" && value === 2550);
  assert.ok(numericGrandTotal !== undefined, "grand total must be a numeric cell matching recognized sales");
});

test("zero-activity report prints a note instead of phantom transaction rows", () => {
  const report = reportFixture([], []);
  const workbook = buildSalesLedgerWorkbook(report);
  const main = workbook.getWorksheet("Sales Report")!;
  const productSheet = workbook.getWorksheet("Product Summary")!;
  const voidSheet = workbook.getWorksheet("Voids")!;

  const noteCount = [main, productSheet, voidSheet].reduce((count, sheet) => {
    let found = 0;
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        if (cell.value === "No valid sales found for this period.") found += 1;
      });
    });
    return count + found;
  }, 0);
  assert.ok(noteCount >= 1);

  const transactionHeaderRow = main.getRow(11);
  const amountColumn = main.getColumn(11).values as Array<unknown>;
  assert.equal(amountColumn.filter((value) => typeof value === "number").length, 1, "only the zero grand total should be numeric");
  const headerValues = Object.values(transactionHeaderRow.values as object) as unknown[];
  assert.ok(headerValues.some((value) => value === "Receipt No."));
});

test("excel file name embeds period and anchor", () => {
  const report = reportFixture([], []);
  assert.equal(salesLedgerFileName(report), "wescomm-sales-report-daily-2026-10-01.xlsx");
});

test("ledger row limit constant guards against silent truncation", () => {
  assert.equal(MAX_SALES_LEDGER_RECEIPTS, 2_000);
});
