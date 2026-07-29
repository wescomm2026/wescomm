import { Prisma } from "@prisma/client";
import assert from "node:assert/strict";
import test from "node:test";
import { WISHLIST_WRITE_TRANSACTION_OPTIONS } from "../services/wishlist.service.js";

test("wishlist writes use bounded serializable transactions", () => {
  assert.deepEqual(WISHLIST_WRITE_TRANSACTION_OPTIONS, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 10_000,
    timeout: 20_000
  });
});
