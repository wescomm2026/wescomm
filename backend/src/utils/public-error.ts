type PublicErrorInput = {
  status: number;
  code?: string;
  message?: string;
};

const publicMessageByCode: Record<string, string> = {
  DATABASE_TEMPORARILY_UNAVAILABLE: "WESCOMM is temporarily unavailable. Please try again in a moment.",
  UPSTREAM_RATE_LIMITED: "WESCOMM is receiving many requests right now. Please wait a moment and try again.",
  INVALID_CURSOR: "This list changed while you were viewing it. Refresh the page and try again.",
  PAYMONGO_DISABLED: "Online GCash payment is temporarily unavailable. Choose another payment option or try again later.",
  PAYMONGO_API_NOT_CONFIGURED: "Online GCash payment is temporarily unavailable. Choose another payment option or try again later.",
  PAYMENT_MAINTENANCE_DISABLED: "Online payment tools are temporarily unavailable. Please try again later.",
  PAYMONGO_AUTH_FAILED: "Online GCash payment is temporarily unavailable. Please try again later.",
  PAYMONGO_CHECKOUT_NOT_FOUND: "This payment link is no longer available. Start the payment again from your reservation.",
  PAYMONGO_CHECKOUT_NOT_EXPIRABLE: "This payment can no longer be closed. Refresh the page to check its latest status.",
  INVALID_CHECKOUT_SESSION: "This payment link is invalid or expired. Start the payment again from your reservation.",
  PROVIDER_ID_CONFLICT: "This payment is already linked to another transaction. Refresh the page before trying again.",
  ONLINE_PAYMENT_SESSION_CONFLICT: "The payment status changed while it was being processed. Refresh the page and try again.",
  ONLINE_PAYMENT_ATTEMPT_CONFLICT: "The payment status changed while it was being processed. Refresh the page and try again.",
  PAYMENT_RECONCILIATION_CONFLICT: "The payment status changed while it was being checked. Refresh the page and try again.",
  INVALID_PAYMONGO_RESPONSE: "WESCOMM could not confirm the payment status. Please try again later.",
  PAYMONGO_MODE_MISMATCH: "WESCOMM could not open the GCash payment. Please try again later.",
  INVALID_CHECKOUT_DESTINATION: "WESCOMM could not open the GCash payment. Please try again later.",
  SKU_AWARE_STOCK_UPDATE_REQUIRED: "Update stock by size or option combination.",
  SKU_NEW_OPTION_ZERO_STOCK_REQUIRED: "New options start with zero stock. Add them to a stock combination before restocking.",
  SKU_OPTION_VALUE_IN_USE: "This option is used by an active stock combination. Update the combinations before removing it.",
  SKU_RECONCILIATION_REQUIRED: "Set up the size or option combinations before updating stock.",
  WESBOT_DISABLED: "WesBot is temporarily unavailable. Staff support is still available.",
  POLICY_ACCEPTANCE_REQUIRED: "Review and accept the current WESCOMM policies before continuing."
};

const technicalMessagePattern = /\b(?:api|backend|database|json|migration|payload|prisma|provider identifiers?|rate snapshot|reconcil(?:e|ing|iation)|request body|route|runtime|schema|semantic mode|server error|session identifier|sku|sql|supabase|token identity|webhook)\b/i;

function statusFallback(status: number) {
  if (status === 400 || status === 422) return "Some information is missing or invalid. Review your entries and try again.";
  if (status === 401) return "Your session has expired. Sign in again to continue.";
  if (status === 403) return "You do not have permission to perform this action.";
  if (status === 404) return "We could not find what you requested.";
  if (status === 409) return "This information changed while you were working. Refresh the page and try again.";
  if (status === 413) return "The selected file or submitted information is too large.";
  if (status === 428) return "Review and accept the current WESCOMM policies before continuing.";
  if (status === 429) return "WESCOMM is receiving many requests right now. Please wait a moment and try again.";
  if (status >= 500) return "WESCOMM could not complete this request right now. Please try again.";
  return "WESCOMM could not complete this request. Please try again.";
}

function isActionableAccessMessage(message: string) {
  return /(?:approved (?:school|WESCOMM).*(?:email|sign-in)|temporary (?:staff )?(?:password )?login)/i.test(message);
}

export function publicErrorMessage({ status, code, message }: PublicErrorInput) {
  const mapped = code ? publicMessageByCode[code] : undefined;
  if (mapped) return mapped;

  const candidate = message?.trim();
  if (
    !candidate
    || status === 401
    || (status === 403 && !isActionableAccessMessage(candidate))
    || status >= 500
    || technicalMessagePattern.test(candidate)
  ) {
    return statusFallback(status);
  }

  return candidate;
}

export function publicErrorDetails(details?: Record<string, unknown>) {
  return details?.retryable === true ? { retryable: true } : undefined;
}
