import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { ONLINE_PAYMENT_STATUSES } from "../types/app.js";

test("frontend payment status contract exactly matches the backend online-payment lifecycle", () => {
  const apiSource = readFileSync(path.resolve(process.cwd(), "../frontend/lib/api.ts"), "utf8");
  const declaration = apiSource.match(/export type BackendPaymentStatus =([\s\S]*?);/)?.[1];
  assert.ok(declaration, "BackendPaymentStatus declaration was not found in frontend/lib/api.ts");

  const frontendStatuses = Array.from(declaration.matchAll(/"([A-Z_]+)"/g), (match) => match[1]);
  assert.deepEqual(frontendStatuses, [...ONLINE_PAYMENT_STATUSES]);
});
