import { createGoogle } from "@ai-sdk/google";
import { env } from "../config/env.js";

let googleProvider: ReturnType<typeof createGoogle> | null = null;

export function getWesbotModel() {
  if (!env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is required for WesBot AI.");
  }

  googleProvider ??= createGoogle({ apiKey: env.GEMINI_API_KEY });
  return googleProvider(env.WESBOT_MODEL);
}
