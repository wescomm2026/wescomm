import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  isTransientPrismaConnectionError,
  withTransientPrismaReadRetry
} from "../utils/prisma-retry.js";

test("transient Prisma connection failures retry one read and then succeed", async () => {
  let attempts = 0;
  const result = await withTransientPrismaReadRetry(async () => {
    attempts += 1;
    if (attempts === 1) throw { code: "P1001" };
    return "connected";
  }, { delayMs: 0 });

  assert.equal(result, "connected");
  assert.equal(attempts, 2);
});

test("non-transient Prisma failures are not retried", async () => {
  let attempts = 0;
  await assert.rejects(withTransientPrismaReadRetry(async () => {
    attempts += 1;
    throw { code: "P2002" };
  }, { delayMs: 0 }));
  assert.equal(attempts, 1);
});

test("only connection and pool-acquisition codes are classified as transient", () => {
  const initializationError = new Prisma.PrismaClientInitializationError(
    "database unavailable",
    Prisma.prismaVersion.client,
    "P1001"
  );
  const uncodedInitializationError = new Prisma.PrismaClientInitializationError(
    "Can't reach database server at example.invalid:5432",
    Prisma.prismaVersion.client,
    undefined
  );

  assert.equal(isTransientPrismaConnectionError({ code: "P1001" }), true);
  assert.equal(isTransientPrismaConnectionError({ errorCode: "P1001" }), true);
  assert.equal(isTransientPrismaConnectionError(initializationError), true);
  assert.equal(isTransientPrismaConnectionError(uncodedInitializationError), true);
  assert.equal(isTransientPrismaConnectionError({ code: "P2024" }), true);
  assert.equal(isTransientPrismaConnectionError({ code: "P2028" }), false);
  assert.equal(isTransientPrismaConnectionError(new Error("network")), false);
});
