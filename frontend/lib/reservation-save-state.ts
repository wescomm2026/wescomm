export type ReservationSaveState = "idle" | "saving" | "saved" | "failed";

const MINIMUM_SAVING_FEEDBACK_MS = 650;

export async function waitForReservationSavingFeedback(startedAt: number) {
  const remaining = MINIMUM_SAVING_FEEDBACK_MS - (Date.now() - startedAt);
  if (remaining <= 0) return;
  await new Promise((resolve) => window.setTimeout(resolve, remaining));
}
