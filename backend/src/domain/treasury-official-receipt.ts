export const TREASURY_OR_MAX_LENGTH = 100;

/**
 * Display form stored on the transaction: trimmed, single-spaced, uppercase.
 */
export function cleanTreasuryOrNumber(value: string | null | undefined) {
  const cleaned = (value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
  return cleaned || null;
}

/**
 * Comparison key. Must match public.normalize_treasury_or_number() in the
 * 20261006000000_add_walk_in_treasury_collection migration, which is the
 * authoritative duplicate guard across reservation payments and walk-in sales.
 */
export function normalizeTreasuryOrNumber(value: string | null | undefined) {
  const normalized = (value ?? "").replace(/[\s-]+/g, "").toUpperCase();
  return normalized || null;
}

export function isTreasuryOrUniqueViolationTarget(target: unknown) {
  return JSON.stringify(target ?? "").includes("official_receipt_number");
}
