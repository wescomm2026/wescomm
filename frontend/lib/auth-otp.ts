export const EMAIL_OTP_LENGTH = 6;

const NON_DIGIT_PATTERN = /\D/g;
const COMPLETE_EMAIL_OTP_PATTERN = new RegExp(`^\\d{${EMAIL_OTP_LENGTH}}$`);

export function normalizeEmailOtp(value: string) {
  return value.replace(NON_DIGIT_PATTERN, "").slice(0, EMAIL_OTP_LENGTH);
}

export function isCompleteEmailOtp(value: string) {
  return COMPLETE_EMAIL_OTP_PATTERN.test(value);
}
