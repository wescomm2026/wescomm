import assert from "node:assert/strict";
import test from "node:test";
import {
  backInStockDedupeKey,
  isBackInStockTransition,
  isProductAvailable
} from "../domain/wishlist-policy.js";

test("product availability requires an active, positive-stock, non-out-of-stock item", () => {
  assert.equal(isProductAvailable({ stock: 1, status: "IN_STOCK", isActive: true }), true);
  assert.equal(isProductAvailable({ stock: 1, status: "ON_SALE", isActive: true }), true);
  assert.equal(isProductAvailable({ stock: 0, status: "IN_STOCK", isActive: true }), false);
  assert.equal(isProductAvailable({ stock: 1, status: "OUT_OF_STOCK", isActive: true }), false);
  assert.equal(isProductAvailable({ stock: 1, status: "IN_STOCK", isActive: false }), false);
});

test("back-in-stock alerts only fire when an unavailable item becomes available", () => {
  assert.equal(
    isBackInStockTransition(
      { stock: 0, status: "OUT_OF_STOCK", isActive: true },
      { stock: 1, status: "IN_STOCK", isActive: true }
    ),
    true
  );
  assert.equal(
    isBackInStockTransition(
      { stock: 5, status: "OUT_OF_STOCK", isActive: true },
      { stock: 5, status: "IN_STOCK", isActive: true }
    ),
    true
  );
  assert.equal(
    isBackInStockTransition(
      { stock: 5, status: "IN_STOCK", isActive: false },
      { stock: 5, status: "IN_STOCK", isActive: true }
    ),
    true
  );
  assert.equal(
    isBackInStockTransition(
      { stock: 1, status: "IN_STOCK", isActive: true },
      { stock: 2, status: "IN_STOCK", isActive: true }
    ),
    false
  );
  assert.equal(
    isBackInStockTransition(
      { stock: 0, status: "OUT_OF_STOCK", isActive: true },
      { stock: 0, status: "OUT_OF_STOCK", isActive: true }
    ),
    false
  );
});

test("back-in-stock delivery keys are stable per event and user", () => {
  const eventId = "11111111-1111-4111-8111-111111111111";
  const firstUserId = "22222222-2222-4222-8222-222222222222";
  const secondUserId = "33333333-3333-4333-8333-333333333333";

  assert.equal(
    backInStockDedupeKey(eventId, firstUserId),
    `back-in-stock:${eventId}:${firstUserId}`
  );
  assert.equal(
    backInStockDedupeKey(eventId, firstUserId),
    backInStockDedupeKey(eventId, firstUserId)
  );
  assert.notEqual(
    backInStockDedupeKey(eventId, firstUserId),
    backInStockDedupeKey(eventId, secondUserId)
  );
});
