import type { BackendPaymentMethod } from "@/lib/api";

export function paymentMethodLabel(value: BackendPaymentMethod) {
  if (value === "PAYMONGO_GCASH") return "GCash – Online";
  if (value === "E_WALLET_AT_PICKUP") return "E-wallet at pickup";
  if (value === "CASH") return "Cash";
  if (value === "GCASH") return "GCash";
  if (value === "OTHER") return "Other";
  return "Cash at Pickup";
}

export function paymentChannel(value: BackendPaymentMethod) {
  return value === "PAYMONGO_GCASH" ? "ONLINE_GCASH" as const : "AT_COMMISSARY" as const;
}
