import { Router } from "express";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { env } from "../config/env.js";
import { supabaseAdmin } from "../lib/supabase.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { createRateLimiter, ipRateLimitKey, userRateLimitKey } from "../middleware/rate-limit.js";
import {
  clearAuthSessionCookie,
  issueAuthSession,
  readAuthSessionToken,
  revokeAuthSession
} from "../services/auth-session.service.js";
import { type RawProfile, mapProfile } from "../types/app.js";
import { isEmailAllowedForDomains, normalizeAllowedEmailDomains } from "../utils/auth-email-policy.js";
import { asyncHandler } from "../utils/async-handler.js";
import { HttpError } from "../utils/http-error.js";

export const authRoutes = Router();

const devLoginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(128)
});

const devLoginLimiter = createRateLimiter({
  namespace: "dev-login",
  windowMs: 15 * 60 * 1000,
  max: 5,
  key: ipRateLimitKey,
  message: "Too many sign-in attempts. Please wait 15 minutes before trying again."
});

const sessionExchangeLimiter = createRateLimiter({
  namespace: "auth-session-exchange",
  windowMs: 15 * 60 * 1000,
  max: 10,
  key: userRateLimitKey,
  message: "Too many session requests. Please wait before signing in again."
});

const allowedDevEmails = new Set(
  env.AUTH_DEV_LOGIN_EMAILS.split(",").map((email) => email.trim().toLowerCase()).filter(Boolean)
);
const allowedEmailDomains = normalizeAllowedEmailDomains(env.AUTH_ALLOWED_EMAIL_DOMAINS);

function secretsMatch(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

authRoutes.post(
  "/dev-login",
  devLoginLimiter,
  asyncHandler(async (request, response) => {
    if (env.NODE_ENV === "production" || !env.AUTH_ENABLE_DEV_LOGIN || !env.AUTH_DEV_LOGIN_PASSWORD) {
      throw new HttpError(403, "Development login is disabled.");
    }

    const input = devLoginSchema.parse(request.body);
    if (!isEmailAllowedForDomains(input.email, allowedEmailDomains)) {
      throw new HttpError(403, `Use an approved school account email domain: ${allowedEmailDomains.join(", ")}.`);
    }
    if (!allowedDevEmails.has(input.email) || !secretsMatch(input.password, env.AUTH_DEV_LOGIN_PASSWORD)) {
      throw new HttpError(401, "Invalid test account credentials.");
    }

    const { data: profileRow, error } = await supabaseAdmin
      .from("profiles")
      .select("*")
      .eq("email", input.email)
      .maybeSingle();

    if (error) throw new HttpError(500, error.message);

    const profile = mapProfile(profileRow as RawProfile | null);
    if (!profile) throw new HttpError(401, "Invalid test account credentials.");

    await revokeAuthSession(readAuthSessionToken(request));
    await issueAuthSession({ request, response, userId: profile.id });

    response.setHeader("Cache-Control", "no-store");
    response.json({ profile });
  })
);

authRoutes.post(
  "/session",
  requireAuth,
  sessionExchangeLimiter,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    await revokeAuthSession(readAuthSessionToken(request));
    await issueAuthSession({ request, response, userId: request.auth!.id });
    response.setHeader("Cache-Control", "no-store");
    response.status(201).json({ profile: request.auth!.profile });
  })
);

authRoutes.post(
  "/logout",
  asyncHandler(async (request, response) => {
    await revokeAuthSession(readAuthSessionToken(request));
    clearAuthSessionCookie(response);
    response.setHeader("Cache-Control", "no-store");
    response.status(204).end();
  })
);

authRoutes.get(
  "/me",
  requireAuth,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.json({ profile: request.auth!.profile });
  })
);
