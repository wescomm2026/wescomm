import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

test("wishlist writes lock and mutate each product in one database statement", () => {
  const source = readFileSync(
    path.resolve(process.cwd(), "src/services/wishlist.service.ts"),
    "utf8"
  );

  assert.doesNotMatch(source, /prisma\s*\.\s*\$transaction/);
  assert.match(source, /WITH locked_product AS MATERIALIZED/);
  assert.match(source, /FOR UPDATE/);
  assert.match(source, /INSERT INTO public\.wishlist_items/);
  assert.match(source, /DELETE FROM public\.wishlist_items/);
});
