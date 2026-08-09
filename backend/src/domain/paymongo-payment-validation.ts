import type { OnlinePaymentStatus } from "../types/app.js";
import type {
  NormalizedPaymongoCheckoutSession,
  NormalizedPaymongoPayment
} from "../utils/paymongo-webhook.js";

export type RecognizedOnlinePayment = {
  id: string;
  status: OnlinePaymentStatus;
  amountCentavos: number;
  currency: string;
  livemode: boolean;
  providerPaymentIntentId: string | null;
  providerPaymentId: string | null;
  paidAt: Date | null;
  createdAt: Date;
  reservation: {
    id: string;
    studentId: string;
    referenceCode: string;
    paymentMethod: string;
    status: string;
  };
};

export type PersistedCheckoutAttempt = {
  id: string;
  onlinePaymentId: string;
  providerCheckoutSessionId: string | null;
  providerPaymentIntentId: string | null;
  providerPaymentId: string | null;
  livemode: boolean;
  createdAt: Date;
};

export type VerifiedPaidCheckout = {
  checkoutSession: NormalizedPaymongoCheckoutSession;
  payment: NormalizedPaymongoPayment;
  paymentIntentId: string;
  paidAt: Date;
};

export type PaidCheckoutValidationResult =
  | { valid: true; value: VerifiedPaidCheckout }
  | { valid: false; reasonCode: string };

export type CheckoutIdentityValidationResult =
  | { valid: true }
  | { valid: false; reasonCode: string };

function paidAtFromProvider(seconds: number | null, receivedAt: Date, earliestCreatedAt: Date) {
  const timestamp = seconds === null ? receivedAt : new Date(seconds * 1000);
  if (
    !Number.isFinite(timestamp.getTime())
    || timestamp > new Date(receivedAt.getTime() + 5 * 60 * 1000)
    || timestamp < new Date(earliestCreatedAt.getTime() - 5 * 60 * 1000)
  ) {
    return null;
  }
  return timestamp;
}

export function validateRecognizedCheckoutIdentity(input: {
  checkoutSession: NormalizedPaymongoCheckoutSession;
  providerLivemode: boolean;
  onlinePayment: RecognizedOnlinePayment;
  attempt: PersistedCheckoutAttempt;
}): CheckoutIdentityValidationResult {
  const { checkoutSession, onlinePayment, attempt } = input;
  if (!/^cs_[A-Za-z0-9_-]+$/.test(checkoutSession.id)) {
    return { valid: false, reasonCode: "INVALID_CHECKOUT_SESSION" };
  }
  if (attempt.onlinePaymentId !== onlinePayment.id) {
    return { valid: false, reasonCode: "ATTEMPT_PAYMENT_MISMATCH" };
  }
  if (attempt.providerCheckoutSessionId && attempt.providerCheckoutSessionId !== checkoutSession.id) {
    return { valid: false, reasonCode: "CHECKOUT_ATTEMPT_MISMATCH" };
  }
  if (checkoutSession.metadata.online_payment_attempt_id !== attempt.id) {
    return { valid: false, reasonCode: "ATTEMPT_METADATA_MISMATCH" };
  }
  if (checkoutSession.metadata.online_payment_id !== onlinePayment.id) {
    return { valid: false, reasonCode: "PAYMENT_METADATA_MISMATCH" };
  }
  if (checkoutSession.metadata.reservation_id !== onlinePayment.reservation.id) {
    return { valid: false, reasonCode: "RESERVATION_METADATA_MISMATCH" };
  }
  if (onlinePayment.reservation.paymentMethod !== "PAYMONGO_GCASH") {
    return { valid: false, reasonCode: "PAYMENT_METHOD_MISMATCH" };
  }
  if (checkoutSession.referenceNumber !== onlinePayment.reservation.referenceCode) {
    return { valid: false, reasonCode: "REFERENCE_MISMATCH" };
  }
  if (
    onlinePayment.livemode !== input.providerLivemode
    || attempt.livemode !== input.providerLivemode
    || onlinePayment.currency.trim() !== "PHP"
  ) {
    return { valid: false, reasonCode: "PAYMENT_MODE_OR_CURRENCY_MISMATCH" };
  }

  return { valid: true };
}

export function validateRecognizedPaidCheckout(input: {
  checkoutSession: NormalizedPaymongoCheckoutSession;
  providerLivemode: boolean;
  onlinePayment: RecognizedOnlinePayment;
  attempt: PersistedCheckoutAttempt;
  receivedAt: Date;
}): PaidCheckoutValidationResult {
  const { checkoutSession, onlinePayment, attempt, receivedAt } = input;
  const identity = validateRecognizedCheckoutIdentity(input);
  if (!identity.valid) return identity;

  const paidPayments = checkoutSession.payments.filter((payment) => payment.status === "paid");
  if (paidPayments.length !== 1) {
    return { valid: false, reasonCode: "INVALID_PAID_PAYMENT_COUNT" };
  }

  const payment = paidPayments[0];
  if (!/^pay_[A-Za-z0-9_-]+$/.test(payment.id)) {
    return { valid: false, reasonCode: "INVALID_PAYMENT_ID" };
  }
  if (payment.sourceType !== "gcash") {
    return { valid: false, reasonCode: "PAYMENT_METHOD_NOT_GCASH" };
  }
  if (
    payment.currency !== "PHP"
    || !Number.isSafeInteger(payment.amountCentavos)
    || payment.amountCentavos !== onlinePayment.amountCentavos
  ) {
    return { valid: false, reasonCode: "PAYMENT_AMOUNT_OR_CURRENCY_MISMATCH" };
  }

  const paymentIntentId = payment.paymentIntentId ?? checkoutSession.paymentIntentId;
  if (!paymentIntentId || !/^pi_[A-Za-z0-9_-]+$/.test(paymentIntentId)) {
    return { valid: false, reasonCode: "INVALID_PAYMENT_INTENT_ID" };
  }
  if (
    payment.paymentIntentId
    && checkoutSession.paymentIntentId
    && payment.paymentIntentId !== checkoutSession.paymentIntentId
  ) {
    return { valid: false, reasonCode: "PAYMENT_INTENT_MISMATCH" };
  }
  if (
    (attempt.providerPaymentIntentId && attempt.providerPaymentIntentId !== paymentIntentId)
    || (attempt.providerPaymentId && attempt.providerPaymentId !== payment.id)
  ) {
    return { valid: false, reasonCode: "PROVIDER_ID_MISMATCH" };
  }

  if (payment.feeCentavos !== null && (
    !Number.isSafeInteger(payment.feeCentavos)
    || payment.feeCentavos < 0
    || payment.feeCentavos > payment.amountCentavos
  )) {
    return { valid: false, reasonCode: "INVALID_PAYMENT_FEE" };
  }
  if (payment.netAmountCentavos !== null && (
    !Number.isSafeInteger(payment.netAmountCentavos)
    || payment.netAmountCentavos < 0
    || payment.netAmountCentavos > payment.amountCentavos
  )) {
    return { valid: false, reasonCode: "INVALID_NET_AMOUNT" };
  }

  const earliestCreatedAt = attempt.createdAt < onlinePayment.createdAt ? attempt.createdAt : onlinePayment.createdAt;
  const paidAt = paidAtFromProvider(payment.paidAtSeconds, receivedAt, earliestCreatedAt);
  if (!paidAt) return { valid: false, reasonCode: "INVALID_PAID_TIMESTAMP" };

  return {
    valid: true,
    value: { checkoutSession, payment, paymentIntentId, paidAt }
  };
}
