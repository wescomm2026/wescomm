import { env } from "../config/env.js";

async function loadGoogleProvider() {
  const { createGoogle } = await import("@ai-sdk/google");
  return createGoogle({ apiKey: env.GEMINI_API_KEY });
}

let googleProviderPromise: ReturnType<typeof loadGoogleProvider> | null = null;

export async function getWesbotModel() {
  if (!env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is required for WesBot AI.");
  }

  googleProviderPromise ??= loadGoogleProvider();
  return (await googleProviderPromise)(env.WESBOT_MODEL);
}
