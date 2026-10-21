import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { assertReceiptVoidAllowed } from "../domain/receipt-void-window.js";
import { WALK_IN_BACKDATE_MAX_DAYS, resolveWalkInSoldAt } from "../domain/walk-in-sale-date.js";
import { parseRecordWalkInSale } from "../domain/walk-in-sale-schemas.js";
import { HttpError } from "../utils/http-error.js";

const now = new Date("2026-10-22T02:00:00.000Z"); // Oct 22, 10:00 AM Manila

function rejectsWith(code: string) {
  return (error: unknown) => error instanceof HttpError && error.status === 400 && error.code === code;
}

test("a walk-in sale without a date happens now", () => {
  assert.equal(resolveWalkInSoldAt(undefined, now), now);
  assert.equal(resolveWalkInSoldAt(null, now), now);
});

test("a past sale date is kept so reports place the sale on that day", () => {
  const soldAt = new Date("2026-10-03T04:00:00.000Z");
  assert.equal(resolveWalkInSoldAt(soldAt, now).toISOString(), soldAt.toISOString());
});

test("sale dates in the future or too far back are refused", () => {
  assert.throws(() => resolveWalkInSoldAt(new Date("2026-10-23T02:00:00.000Z"), now), rejectsWith("SOLD_AT_IN_FUTURE"));
  const tooOld = new Date(now.getTime() - (WALK_IN_BACKDATE_MAX_DAYS + 1) * 24 * 60 * 60 * 1000);
  assert.throws(() => resolveWalkInSoldAt(tooOld, now), rejectsWith("SOLD_AT_TOO_OLD"));
  assert.throws(() => resolveWalkInSoldAt(new Date("nope"), now), rejectsWith("INVALID_SOLD_AT"));
});

test("a few minutes of device clock drift is clamped to now", () => {
  const drift = new Date(now.getTime() + 2 * 60 * 1000);
  assert.equal(resolveWalkInSoldAt(drift, now), now);
});

test("the void period follows the purchase date, so correcting an old entry needs an admin", () => {
  // Sold Oct 3, entered Oct 22: staff returns ended Oct 5; only an admin may void it now.
  const soldAt = new Date("2026-10-03T04:00:00.000Z");
  assert.throws(
    () => assertReceiptVoidAllowed({ actorRole: "STAFF", soldAt, now }),
    (error: unknown) => error instanceof HttpError && error.status === 403 && error.code === "RECEIPT_VOID_WINDOW_CLOSED"
  );
  assert.doesNotThrow(() => assertReceiptVoidAllowed({ actorRole: "ADMIN", soldAt, now }));
  // Sold yesterday, entered today: still within the customer's 2-day return period.
  assert.doesNotThrow(() => assertReceiptVoidAllowed({ actorRole: "STAFF", soldAt: new Date("2026-10-21T04:00:00.000Z"), now }));
});

test("the walk-in payload accepts an optional ISO sale date", () => {
  const base = {
    items: [{ productId: "4a7b3f9e-0f3c-4d7e-9a51-2d5c8f0e1b6a", quantity: 1 }],
    buyerName: "Juan Dela Cruz",
    clientSaleId: "walkin_12345678",
    cashReceived: 100
  };
  assert.equal(parseRecordWalkInSale(base).soldAt, undefined);
  assert.equal(parseRecordWalkInSale({ ...base, soldAt: "2026-10-03T12:00:00+08:00" }).soldAt, "2026-10-03T12:00:00+08:00");
  assert.throws(() => parseRecordWalkInSale({ ...base, soldAt: "Oct 3" }));
});

test("the receipt is stamped with the sale date and the route passes it through", () => {
  const walkInService = readFileSync(path.resolve(process.cwd(), "src/services/walk-in-sale.service.ts"), "utf8");
  const routes = readFileSync(path.resolve(process.cwd(), "src/routes/walk-in-sales.routes.ts"), "utf8");
  assert.match(walkInService, /issuedAt: soldAt,\s*verifiedAt: soldAt/);
  assert.match(routes, /soldAt: input\.soldAt \? new Date\(input\.soldAt\) : null/);
});
