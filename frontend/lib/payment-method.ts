import type { BackendPaymentMethod } from "@/lib/api";

export function paymentMethodLabel(value: BackendPaymentMethod) {
  return value === "PAYMONGO_GCASH" ? "GCash – Online" : "Pay at Commissary";
}

export function paymentChannel(value: BackendPaymentMethod) {
  return value === "PAYMONGO_GCASH" ? "ONLINE_GCASH" as const : "AT_COMMISSARY" as const;
}
