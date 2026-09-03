import { createHash, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../lib/prisma.js";
import { createPostgresRateLimitStore } from "../middleware/rate-limit.js";

test("PostgreSQL rate-limit counters are atomic, shared, expiring, and privacy-preserving", async () => {
  const rawKey = `integration-rate-limit:${randomUUID()}`;
  const keyHash = createHash("sha256").update(rawKey).digest("hex");
  const firstStore = createPostgresRateLimitStore();
  const secondStore = createPostgresRateLimitStore();
  const now = Date.now();

  try {
    const increments = await Promise.all(Array.from({ length: 24 }, (_, index) => (
      (index % 2 === 0 ? firstStore : secondStore).increment(rawKey, 60_000, now)
    )));
    assert.deepEqual(increments.map((entry) => entry.count).sort((a, b) => a - b), Array.from({ length: 24 }, (_, index) => index + 1));
    assert.ok(increments.every((entry) => entry.resetAt === now + 60_000));

    const persisted = await prisma.rateLimitCounter.findUniqueOrThrow({ where: { keyHash } });
    assert.equal(persisted.count, 24);
    assert.equal(persisted.keyHash, keyHash);
    assert.equal(persisted.keyHash.includes(rawKey), false);

    const reset = await secondStore.increment(rawKey, 30_000, now + 60_001);
    assert.equal(reset.count, 1);
    assert.equal(reset.resetAt, now + 90_001);
  } finally {
    await prisma.rateLimitCounter.deleteMany({ where: { keyHash } });
  }
});
