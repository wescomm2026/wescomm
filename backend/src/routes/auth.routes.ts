import { Router } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { env } from "../config/env.js";
import { profileUpdateSchema } from "../domain/profile-update.js";
import {
  MAX_TEMPORARY_STAFF_SESSION_MS,
  TEMPORARY_PRODUCTION_STAFF_EMAIL,
  isTemporaryProductionStaffIdentity,
  temporaryStaffLoginExpirationMs
} from "../domain/temporary-staff-login-policy.js";
import { supabaseAdmin } from "../lib/supabase.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { createRateLimiter, ipRateLimitKey, userRateLimitKey } from "../middleware/rate-limit.js";
import { requireBearerSessionExchange } from "../middleware/require-bearer-session-exchange.js";
import {
  clearAuthSessionCookie,
  issueAuthSession,
  readAuthSessionToken,
  revokeAuthSession
} from "../services/auth-session.service.js";
import { safelyRecordAuditLog } from "../services/audit-log.service.js";
import { updateOwnProfile } from "../services/profile.service.js";
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

const temporaryStaffLoginLimiter = createRateLimiter({
  namespace: "temporary-production-staff-login",
  windowMs: 15 * 60 * 1000,
  max: 3,
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

const profileUpdateLimiter = createRateLimiter({
  namespace: "profile-update",
  windowMs: 15 * 60 * 1000,
  max: 30,
  key: userRateLimitKey,
  message: "Profile update limit reached. Please wait before making more changes."
});

const allowedDevEmails = new Set(
  env.AUTH_DEV_LOGIN_EMAILS.split(",").map((email) => email.trim().toLowerCase()).filter(Boolean)
);
const allowedEmailDomains = normalizeAllowedEmailDomains(env.AUTH_ALLOWED_EMAIL_DOMAINS);

function secretsMatch(left: string, right: string) {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

async function loadPasswordLoginProfile(email: string) {
  const { data: profileRow, error } = await supabaseAdmin
    .from("profiles")
    .select("*")
    .eq("email", email)
    .maybeSingle();

  if (error) throw new HttpError(500, error.message);
  return mapProfile(profileRow as RawProfile | null);
}

authRoutes.post(
  "/dev-login",
  devLoginLimiter,
  asyncHandler(async (request, response) => {
    if (env.IS_PRODUCTION_DEPLOYMENT || !env.AUTH_ENABLE_DEV_LOGIN || !env.AUTH_DEV_LOGIN_PASSWORD) {
      throw new HttpError(403, "Development login is disabled.");
    }

    const input = devLoginSchema.parse(request.body);
    if (!isEmailAllowedForDomains(input.email, allowedEmailDomains)) {
      throw new HttpError(403, `Use an approved school account email domain: ${allowedEmailDomains.join(", ")}.`);
    }
    const passwordMatches = secretsMatch(input.password, env.AUTH_DEV_LOGIN_PASSWORD);
    if (!allowedDevEmails.has(input.email) || !passwordMatches) {
      throw new HttpError(401, "Invalid test account credentials.");
    }

    const profile = await loadPasswordLoginProfile(input.email);
    if (!profile) throw new HttpError(401, "Invalid test account credentials.");

    await revokeAuthSession(readAuthSessionToken(request));
    await issueAuthSession({ request, response, userId: profile.id });

    response.setHeader("Cache-Control", "no-store");
    response.json({ profile });
  })
);

authRoutes.post(
  "/temporary-staff-login",
  temporaryStaffLoginLimiter,
  asyncHandler(async (request, response) => {
    const initialExpirationMs = temporaryStaffLoginExpirationMs(env);
    const expectedPassword = env.AUTH_TEMP_PRODUCTION_STAFF_LOGIN_PASSWORD;
    if (!initialExpirationMs || !expectedPassword) {
      throw new HttpError(403, "Temporary staff password login is disabled or expired.");
    }

    const input = devLoginSchema.parse(request.body);
    const passwordMatches = secretsMatch(input.password, expectedPassword);
    if (input.email !== TEMPORARY_PRODUCTION_STAFF_EMAIL || !passwordMatches) {
      throw new HttpError(401, "Invalid test account credentials.");
    }

    const profile = await loadPasswordLoginProfile(input.email);
    if (!profile || !isTemporaryProductionStaffIdentity(profile.email, profile.role)) {
      throw new HttpError(401, "Invalid test account credentials.");
    }

    const currentExpirationMs = temporaryStaffLoginExpirationMs(env);
    if (!currentExpirationMs) {
      throw new HttpError(403, "Temporary staff password login is disabled or expired.");
    }

    const maximumSessionExpiration = new Date(Math.min(
      currentExpirationMs,
      Date.now() + MAX_TEMPORARY_STAFF_SESSION_MS
    ));
    await revokeAuthSession(readAuthSessionToken(request));
    await issueAuthSession({
      request,
      response,
      userId: profile.id,
      maximumExpiresAt: maximumSessionExpiration,
      kind: "TEMPORARY_STAFF"
    });
    await safelyRecordAuditLog({
      actorId: profile.id,
      action: "TEMPORARY_STAFF_PASSWORD_LOGIN",
      entityType: "auth_session",
      entityId: profile.id,
      summary: `Temporary Production password login used by ${profile.email}.`,
      metadata: {
        expiresAt: new Date(currentExpirationMs).toISOString(),
        requestId: String(response.locals.requestId ?? "")
      }
    });

    response.setHeader("Cache-Control", "no-store");
    response.json({ profile });
  })
);

authRoutes.post(
  "/session",
  requireAuth,
  requireBearerSessionExchange,
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

authRoutes.patch(
  "/me",
  requireAuth,
  profileUpdateLimiter,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const input = profileUpdateSchema.parse(request.body);
    const profile = await updateOwnProfile(request.auth!.profile, input);
    response.setHeader("Cache-Control", "no-store");
    response.json({ profile });
  })
);
