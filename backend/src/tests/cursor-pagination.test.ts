import assert from "node:assert/strict";
import test from "node:test";
import {
  createPage,
  decodeCursor,
  encodeCursor,
  normalizePageLimit
} from "../utils/cursor-pagination.js";
import { HttpError } from "../utils/http-error.js";

const firstId = "11111111-1111-4111-8111-111111111111";
const secondId = "22222222-2222-4222-8222-222222222222";

test("cursor pagination has safe server defaults and maximums", () => {
  assert.equal(normalizePageLimit(), 20);
  assert.equal(normalizePageLimit(0), 1);
  assert.equal(normalizePageLimit(500), 50);
});

test("opaque cursors round-trip a UUID and reject malformed input", () => {
  const cursor = encodeCursor(firstId);
  assert.notEqual(cursor, firstId);
  assert.equal(decodeCursor(cursor), firstId);
  assert.throws(
    () => decodeCursor("not-a-valid-cursor"),
    (error: unknown) => error instanceof HttpError && error.code === "INVALID_CURSOR"
  );
});

test("page creation fetches one extra row without exposing it", () => {
  const page = createPage([{ id: firstId }, { id: secondId }], 1);
  assert.deepEqual(page.items, [{ id: firstId }]);
  assert.equal(decodeCursor(page.nextCursor), firstId);
  assert.deepEqual(createPage([{ id: firstId }], 1), { items: [{ id: firstId }], nextCursor: null });
});
