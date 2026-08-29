const RESERVATION_REFERENCE = /\bWES-\d{4}-[A-Z0-9]{6,16}\b/gi;
const RECEIPT_CODE = /\b(?:RCT|REC)-\d{4}-[A-Z0-9]{6,16}\b/gi;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE = /(?<!\w)(?:\+?63|0)?9\d{9}(?!\w)/g;
const LONG_NUMBER = /(?<!\w)\d{6,}(?!\w)/g;

/** Removes record identifiers and direct contact details before text is sent to Gemini. */
export function redactWesbotAiText(value: string) {
  return value
    .replace(RESERVATION_REFERENCE, "[RESERVATION_REFERENCE]")
    .replace(RECEIPT_CODE, "[RECEIPT_CODE]")
    .replace(UUID, "[RECORD_ID]")
    .replace(EMAIL, "[EMAIL]")
    .replace(PHONE, "[PHONE]")
    .replace(LONG_NUMBER, "[LONG_NUMBER]");
}

export function redactWesbotAiContext<T extends { text: string }>(context: T[]) {
  return context.map((entry) => ({ ...entry, text: redactWesbotAiText(entry.text) }));
}
