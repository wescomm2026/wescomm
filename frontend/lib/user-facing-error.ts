type ApiErrorInput = {
  status: number;
  code?: string;
  serverMessage?: string;
  requestId?: string;
};

const messageByCode: Record<string, string> = {
  OFFLINE: "You are offline. Connect to the internet, then try again.",
  NETWORK_UNAVAILABLE: "WESCOMM cannot be reached right now. Check your connection and try again.",
  REQUEST_TIMEOUT: "WESCOMM is taking longer than expected. Please try again.",
  DATABASE_TEMPORARILY_UNAVAILABLE: "WESCOMM is temporarily unavailable. Please try again in a moment.",
  UPSTREAM_RATE_LIMITED: "WESCOMM is receiving many requests right now. Please wait a moment and try again.",
  INVALID_CURSOR: "This list changed while you were viewing it. Refresh the page and try again.",
  PAYMONGO_DISABLED: "Online GCash payment is temporarily unavailable. Choose another payment option or try again later.",
  PAYMONGO_API_NOT_CONFIGURED: "Online GCash payment is temporarily unavailable. Choose another payment option or try again later.",
  PAYMONGO_AUTH_FAILED: "Online GCash payment is temporarily unavailable. Please try again later.",
  PAYMONGO_CHECKOUT_NOT_FOUND: "This payment link is no longer available. Start the payment again from your reservation.",
  PAYMONGO_CHECKOUT_NOT_EXPIRABLE: "This payment can no longer be closed. Refresh the page to check its latest status.",
  INVALID_CHECKOUT_SESSION: "This payment link is invalid or expired. Start the payment again from your reservation.",
  PROVIDER_ID_CONFLICT: "This payment is already linked to another transaction. Refresh the page before trying again.",
  ONLINE_PAYMENT_SESSION_CONFLICT: "The payment status changed while it was being processed. Refresh the page and try again.",
  ONLINE_PAYMENT_ATTEMPT_CONFLICT: "The payment status changed while it was being processed. Refresh the page and try again.",
  PAYMENT_RECONCILIATION_CONFLICT: "The payment status changed while it was being checked. Refresh the page and try again.",
  SKU_AWARE_STOCK_UPDATE_REQUIRED: "Update stock by size or option combination.",
  SKU_NEW_OPTION_ZERO_STOCK_REQUIRED: "New options start with zero stock. Add them to a stock combination before restocking.",
  SKU_OPTION_VALUE_IN_USE: "This option is used by an active stock combination. Update the combinations before removing it.",
  SKU_RECONCILIATION_REQUIRED: "Set up the size or option combinations before updating stock.",
  WESBOT_DISABLED: "WesBot is temporarily unavailable. Staff support is still available.",
  PICKUP_SLOT_FULL: "That pickup time just became full. Choose another available time.",
  POLICY_ACCEPTANCE_REQUIRED: "Review and accept the current WESCOMM policies before continuing."
};

const technicalMessagePattern = /\b(?:api|backend|database|internal server|json|migration|payload|prisma|provider identifiers?|rate snapshot|reconcil(?:e|ing|iation)|request body|route|runtime|schema|semantic mode|session identifier|sku|sql|supabase|token identity|webhook)\b/i;

function fallbackForStatus(status: number) {
  if (status === 0) return "WESCOMM cannot be reached right now. Check your connection and try again.";
  if (status === 400 || status === 422) return "Some information is missing or invalid. Review your entries and try again.";
  if (status === 401) return "Your session has expired. Sign in again to continue.";
  if (status === 403) return "You do not have permission to perform this action.";
  if (status === 404) return "We could not find what you requested.";
  if (status === 408) return "WESCOMM is taking longer than expected. Please try again.";
  if (status === 409) return "This information changed while you were working. Refresh the page and try again.";
  if (status === 413) return "The selected file or submitted information is too large.";
  if (status === 428) return "Review and accept the current WESCOMM policies before continuing.";
  if (status === 429) return "WESCOMM is receiving many requests right now. Please wait a moment and try again.";
  if (status >= 500) return "WESCOMM could not complete this request right now. Please try again.";
  return "WESCOMM could not complete this request. Please try again.";
}

function supportReference(message: string, status: number, requestId?: string) {
  const reference = requestId?.trim();
  if (status < 500 || !reference) return message;
  return `${message} Support reference: ${reference}.`;
}

function isActionableAccessMessage(message: string) {
  return /(?:approved (?:school|WESCOMM).*(?:email|sign-in)|temporary (?:staff )?(?:password )?login)/i.test(message);
}

export function apiErrorMessage({ status, code, serverMessage, requestId }: ApiErrorInput) {
  const mapped = code ? messageByCode[code] : undefined;
  if (mapped) return supportReference(mapped, status, requestId);

  const candidate = serverMessage?.trim();
  const message = !candidate
    || status === 401
    || (status === 403 && !isActionableAccessMessage(candidate))
    || status >= 500
    || technicalMessagePattern.test(candidate)
    ? fallbackForStatus(status)
    : candidate;
  return supportReference(message, status, requestId);
}

export function userFacingErrorMessage(error: unknown, fallback: string) {
  if (typeof error !== "object" || !error) return fallback;

  const candidate = error as {
    message?: unknown;
    status?: unknown;
    code?: unknown;
    requestId?: unknown;
  };
  const message = typeof candidate.message === "string" ? candidate.message.trim() : "";
  if (!message || message === "{}") return fallback;

  if (typeof candidate.status === "number") {
    return apiErrorMessage({
      status: candidate.status,
      code: typeof candidate.code === "string" ? candidate.code : undefined,
      serverMessage: message,
      requestId: typeof candidate.requestId === "string" ? candidate.requestId : undefined
    });
  }

  return technicalMessagePattern.test(message) ? fallback : message;
}
