function maskToken(value: string, visibleSuffixLength: number) {
  const cleanValue = value.trim();
  if (!cleanValue) return null;
  const suffixLength = Math.min(visibleSuffixLength, cleanValue.length);
  return `${"*".repeat(Math.max(4, cleanValue.length - suffixLength))}${cleanValue.slice(-suffixLength)}`;
}

export function maskPublicPersonName(value?: string | null) {
  const parts = value?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (!parts.length) return "Verified student";

  const firstName = parts[0];
  const maskedFirstName = `${firstName.slice(0, 1)}${"*".repeat(Math.min(4, Math.max(3, firstName.length - 1)))}`;
  if (parts.length === 1) return maskedFirstName;

  return `${maskedFirstName} ${parts.at(-1)?.slice(0, 1) ?? ""}.`;
}

export function maskPublicStudentNumber(value?: string | null) {
  return maskToken(value ?? "", 4);
}

export function maskPublicReferenceCode(value?: string | null) {
  return maskToken(value ?? "", 4);
}

export function summarizePublicReceiptItems(items: Array<{ quantity: number }> | null | undefined) {
  return (items ?? []).reduce(
    (summary, item) => ({
      itemCount: summary.itemCount + 1,
      totalQuantity: summary.totalQuantity + item.quantity
    }),
    { itemCount: 0, totalQuantity: 0 }
  );
}
