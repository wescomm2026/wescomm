import { createHash } from "node:crypto";

export const PAYMENT_CONVERSION_APPLY_FLAG = "--apply";
export const PAYMENT_CONVERSION_CONFIRM_PREFIX = "--confirm-apply:";

function normalizedDatabaseTarget(databaseUrl: string | undefined) {
  const rawUrl = databaseUrl?.trim();
  if (!rawUrl) {
    throw new Error("DATABASE_URL is required to identify the payment-conversion target.");
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("DATABASE_URL is malformed; refusing to identify the payment-conversion target.");
  }

  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error("Payment conversion requires a PostgreSQL DATABASE_URL.");
  }

  const hostname = parsed.hostname.trim().toLowerCase();
  const port = parsed.port || "5432";
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, "")).trim().toLowerCase();
  const username = decodeURIComponent(parsed.username).trim().toLowerCase();
  const schema = (parsed.searchParams.get("schema") ?? "public").trim().toLowerCase();
  if (!hostname || !databaseName || !username || !schema) {
    throw new Error("DATABASE_URL must include a username, hostname, database name, and valid schema target.");
  }

  // The username is part of the target because shared PostgreSQL pooler hosts
  // commonly encode the project identifier there. Passwords and query-string
  // options other than Prisma's target schema are intentionally excluded.
  return `${parsed.protocol}//${username}@${hostname}:${port}/${databaseName}?schema=${schema}`;
}

export function databaseTargetFingerprint(databaseUrl: string | undefined) {
  return createHash("sha256")
    .update(normalizedDatabaseTarget(databaseUrl))
    .digest("hex")
    .slice(0, 12);
}

export const paymentConversionTargetFingerprint = databaseTargetFingerprint;

export function resolvePaymentConversionCliPolicy(input: {
  args: string[];
  databaseUrl: string | undefined;
}) {
  const dryRun = !input.args.includes(PAYMENT_CONVERSION_APPLY_FLAG);
  const fingerprint = databaseTargetFingerprint(input.databaseUrl);
  const expectedConfirmation = `${PAYMENT_CONVERSION_CONFIRM_PREFIX}${fingerprint}`;

  if (!dryRun) {
    const confirmations = input.args.filter((argument) => argument.startsWith(PAYMENT_CONVERSION_CONFIRM_PREFIX));
    if (confirmations.length !== 1 || confirmations[0] !== expectedConfirmation) {
      throw new Error(
        `Apply requires an explicit database-target confirmation.\n`
        + `Database fingerprint: ${fingerprint}\n`
        + `Re-run with: ${PAYMENT_CONVERSION_APPLY_FLAG} ${expectedConfirmation}`
      );
    }
  }

  return { dryRun, fingerprint, expectedConfirmation };
}
