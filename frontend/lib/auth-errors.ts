import { isAuthApiError, isAuthRetryableFetchError } from "@supabase/supabase-js";

const OTP_SEND_RETRY_SECONDS = 60;

export type OtpSendFailure = {
  message: string;
  code: string;
  retryAfterSeconds?: number;
};

function readErrorField(error: unknown, field: "code" | "status") {
  if (typeof error !== "object" || !error || !(field in error)) return undefined;
  return (error as Record<typeof field, unknown>)[field];
}

export function describeOtpSendError(error: unknown): OtpSendFailure {
  const apiStatus = isAuthApiError(error) ? error.status : readErrorField(error, "status");
  const status = typeof apiStatus === "number" ? apiStatus : undefined;
  const apiCode = isAuthApiError(error) ? error.code : readErrorField(error, "code");
  const code = typeof apiCode === "string" ? apiCode.toLowerCase() : "otp_send_failed";

  if (
    status === 429 ||
    code === "over_email_send_rate_limit" ||
    code === "over_request_rate_limit"
  ) {
    return {
      message: "Too many verification-code requests. Please wait a minute and try again.",
      code: code === "otp_send_failed" ? "rate_limited" : code,
      retryAfterSeconds: OTP_SEND_RETRY_SECONDS
    };
  }

  if (code === "email_address_not_authorized") {
    return {
      message: "Email delivery is not configured for this account yet. Please contact WESCOMM support.",
      code
    };
  }

  if (code === "email_address_invalid" || code === "validation_failed") {
    return {
      message: "Please check your official school email address and try again.",
      code
    };
  }

  if (code === "captcha_failed") {
    return {
      message: "The security check failed. Please refresh the page and try again.",
      code
    };
  }

  if (
    code === "otp_disabled" ||
    code === "email_provider_disabled" ||
    code === "signup_disabled"
  ) {
    return {
      message: "Email login is not available right now. Please contact WESCOMM support.",
      code
    };
  }

  const isNetworkFailure = error instanceof TypeError;
  if (
    isAuthRetryableFetchError(error) ||
    isNetworkFailure ||
    (status !== undefined && status >= 500) ||
    code === "unexpected_failure"
  ) {
    return {
      message: "The email service is temporarily unavailable. Please try again in a few minutes or contact WESCOMM support.",
      code: code === "otp_send_failed" ? "email_service_unavailable" : code,
      retryAfterSeconds: OTP_SEND_RETRY_SECONDS
    };
  }

  return {
    message: "We could not send your verification code. Please try again later.",
    code
  };
}
