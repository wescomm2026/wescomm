import { Prisma, type PrismaClient } from "@prisma/client";
import { HttpError } from "./http-error.js";

const RESTRICTION_TRANSACTION_BUDGET = Object.freeze({
  maxWait: 10_000,
  timeout: 20_000
});

/**
 * Restriction reads perform several dependent queries against the remote
 * database. Keep them bounded without paying Serializable isolation costs.
 */
export const RESTRICTION_READ_TRANSACTION_OPTIONS = Object.freeze({
  ...RESTRICTION_TRANSACTION_BUDGET
});

/**
 * Restriction writes use Serializable isolation so check-then-write policy
 * decisions cannot silently commit from stale snapshots.
 */
export const RESTRICTION_WRITE_TRANSACTION_OPTIONS = Object.freeze({
  ...RESTRICTION_TRANSACTION_BUDGET,
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable
});

export function mapRestrictionTransactionError(error: unknown): unknown {
  if (error instanceof HttpError) return error;
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return error;

  if (error.code === "P2002") {
    return new HttpError(
      409,
      "This student already has an active reservation restriction.",
      "ACTIVE_RESTRICTION_EXISTS"
    );
  }

  if (error.code === "P2034") {
    return new HttpError(
      409,
      "Restriction data changed while processing. Please try again.",
      "RESTRICTION_WRITE_CONFLICT",
      { retryable: true }
    );
  }

  if (error.code === "P2024" || error.code === "P2028") {
    return new HttpError(
      503,
      "Restriction service is temporarily busy. Please try again.",
      "RESTRICTION_TRANSACTION_UNAVAILABLE",
      { retryable: true }
    );
  }

  return error;
}

export function assertSingleRestrictionMutation(
  result: { count: number },
  message: string,
  code: string
) {
  if (result.count !== 1) throw new HttpError(409, message, code);
}

export async function runRestrictionReadTransaction<T>(
  client: PrismaClient,
  operation: (tx: Prisma.TransactionClient) => Promise<T>
) {
  try {
    return await client.$transaction(operation, RESTRICTION_READ_TRANSACTION_OPTIONS);
  } catch (error) {
    throw mapRestrictionTransactionError(error);
  }
}

export async function runRestrictionWriteTransaction<T>(
  client: PrismaClient,
  operation: (tx: Prisma.TransactionClient) => Promise<T>
) {
  try {
    return await client.$transaction(operation, RESTRICTION_WRITE_TRANSACTION_OPTIONS);
  } catch (error) {
    throw mapRestrictionTransactionError(error);
  }
}
