import { Prisma, type PrismaClient } from "@prisma/client";
import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../utils/http-error.js";
import {
  RESTRICTION_READ_TRANSACTION_OPTIONS,
  RESTRICTION_WRITE_TRANSACTION_OPTIONS,
  assertSingleRestrictionMutation,
  mapRestrictionTransactionError,
  runRestrictionReadTransaction,
  runRestrictionWriteTransaction
} from "../utils/restriction-transaction.js";

function knownPrismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError(`Prisma ${code}`, {
    code,
    clientVersion: "test"
  });
}

function assertHttpError(error: unknown, status: number, code: string) {
  assert.ok(error instanceof HttpError);
  assert.equal(error.status, status);
  assert.equal(error.code, code);
  return error;
}

test("restriction reads and writes share a bounded latency budget while writes are Serializable", () => {
  assert.deepEqual(RESTRICTION_READ_TRANSACTION_OPTIONS, {
    maxWait: 10_000,
    timeout: 20_000
  });
  assert.deepEqual(RESTRICTION_WRITE_TRANSACTION_OPTIONS, {
    maxWait: 10_000,
    timeout: 20_000,
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable
  });
});

test("restriction transaction helpers pass the correct options to Prisma", async () => {
  const observedOptions: unknown[] = [];
  const client = {
    $transaction: async (_operation: unknown, options: unknown) => {
      observedOptions.push(options);
      return "completed";
    }
  } as unknown as PrismaClient;

  assert.equal(await runRestrictionReadTransaction(client, async () => "unused"), "completed");
  assert.equal(await runRestrictionWriteTransaction(client, async () => "unused"), "completed");
  assert.deepEqual(observedOptions, [
    RESTRICTION_READ_TRANSACTION_OPTIONS,
    RESTRICTION_WRITE_TRANSACTION_OPTIONS
  ]);
});

test("restriction transaction errors map duplicate and serialization conflicts to stable conflicts", () => {
  assertHttpError(
    mapRestrictionTransactionError(knownPrismaError("P2002")),
    409,
    "ACTIVE_RESTRICTION_EXISTS"
  );
  const conflict = assertHttpError(
    mapRestrictionTransactionError(knownPrismaError("P2034")),
    409,
    "RESTRICTION_WRITE_CONFLICT"
  );
  assert.equal(conflict.details?.retryable, true);
});

test("restriction transaction wait and execution timeouts map to retryable service errors", () => {
  for (const code of ["P2024", "P2028"]) {
    const mapped = assertHttpError(
      mapRestrictionTransactionError(knownPrismaError(code)),
      503,
      "RESTRICTION_TRANSACTION_UNAVAILABLE"
    );
    assert.equal(mapped.details?.retryable, true);
  }
});

test("restriction transaction mapping preserves domain and unknown errors", () => {
  const domainError = new HttpError(403, "Forbidden", "FORBIDDEN");
  const unknownError = new Error("Unexpected");
  assert.equal(mapRestrictionTransactionError(domainError), domainError);
  assert.equal(mapRestrictionTransactionError(unknownError), unknownError);
});

test("guarded restriction mutations accept exactly one winner", () => {
  assert.doesNotThrow(() => assertSingleRestrictionMutation({ count: 1 }, "Already changed", "ALREADY_CHANGED"));
  assert.throws(
    () => assertSingleRestrictionMutation({ count: 0 }, "Already changed", "ALREADY_CHANGED"),
    (error: unknown) => {
      assertHttpError(error, 409, "ALREADY_CHANGED");
      return true;
    }
  );
});
