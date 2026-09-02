import { HttpError } from "../utils/http-error.js";

export const ACCOUNT_POLICY_VERSION = "2026-09-02";
export const CHECKOUT_POLICY_VERSION = "2026-09-02";

export type SubmittedPolicyAcceptance = {
  accepted?: boolean;
  version?: string;
};

function assertCurrentPolicyAcceptance(
  input: SubmittedPolicyAcceptance | null | undefined,
  expectedVersion: string,
  message: string
) {
  if (!input?.accepted || input.version !== expectedVersion) {
    throw new HttpError(428, message, "POLICY_ACCEPTANCE_REQUIRED", {
      expectedVersion
    });
  }
  return expectedVersion;
}

export function assertCurrentAccountPolicyAcceptance(input: SubmittedPolicyAcceptance | null | undefined) {
  return assertCurrentPolicyAcceptance(
    input,
    ACCOUNT_POLICY_VERSION,
    "Review and accept the current WESCOMM Terms and Privacy Policy to sign in."
  );
}

export function assertCurrentCheckoutPolicyAcceptance(input: SubmittedPolicyAcceptance | null | undefined) {
  return assertCurrentPolicyAcceptance(
    input,
    CHECKOUT_POLICY_VERSION,
    "Review and accept the current reservation, pickup, and refund terms before confirming."
  );
}
