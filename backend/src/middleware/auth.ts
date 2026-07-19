import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";
import {
  evaluateAuthenticationMethods,
  normalizeAllowedAuthMethods
} from "../domain/auth-method-policy.js";
import { supabaseAdmin } from "../lib/supabase.js";
import {
  clearAuthSessionCookie,
  readAuthSessionToken,
  revokeAuthSessionsForUser,
  resolveAuthSession
} from "../services/auth-session.service.js";
import { type AppRole, type Profile, type RawProfile, mapProfile } from "../types/app.js";
import { isEmailAllowedForDomains, normalizeAllowedEmailDomains } from "../utils/auth-email-policy.js";
import { HttpError } from "../utils/http-error.js";

export type AuthContext = {
  id: string;
  email: string;
  role: AppRole;
  profile: Profile;
  method: "COOKIE" | "BEARER";
  sessionId?: string;
};

export type AuthenticatedRequest = Request & {
  auth?: AuthContext;
};

function getBearerToken(request: Request) {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim();
}

function normalizeCsv(value: string) {
  return value
    .split(",")
    .map((item) => item.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

const allowedEmailDomains = normalizeAllowedEmailDomains(env.AUTH_ALLOWED_EMAIL_DOMAINS);
const allowedAuthMethods = normalizeAllowedAuthMethods(env.AUTH_ALLOWED_AUTH_METHODS);

function approvedSchoolEmailError() {
  return new HttpError(403, `Use an approved school account email domain: ${allowedEmailDomains.join(", ")}.`);
}

async function loadProfileById(id: string) {
  const { data: profileRow, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (profileError) throw new HttpError(500, profileError.message);
  return mapProfile(profileRow as RawProfile | null);
}

export async function requireAuth(request: AuthenticatedRequest, response: Response, next: NextFunction) {
  try {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Pragma", "no-cache");
    const token = getBearerToken(request);
    if (!token) {
      const sessionToken = readAuthSessionToken(request);
      if (!sessionToken) return next(new HttpError(401, "Authentication is required."));

      const session = await resolveAuthSession(sessionToken);
      if (!session) {
        clearAuthSessionCookie(response);
        return next(new HttpError(401, "Session is invalid or expired."));
      }
      if (!isEmailAllowedForDomains(session.profile.email, allowedEmailDomains)) {
        clearAuthSessionCookie(response);
        return next(approvedSchoolEmailError());
      }

      request.auth = {
        id: session.profile.id,
        email: session.profile.email,
        role: session.profile.role,
        profile: session.profile,
        method: "COOKIE",
        sessionId: session.sessionId
      };
      return next();
    }

    const [{ data, error }, claimsResult] = await Promise.all([
      supabaseAdmin.auth.getUser(token),
      supabaseAdmin.auth.getClaims(token)
    ]);
    if (error || claimsResult.error || !data.user?.email || !claimsResult.data?.claims) {
      return next(new HttpError(401, "Invalid or expired token."));
    }
    if (claimsResult.data.claims.sub !== data.user.id) {
      return next(new HttpError(401, "Token identity could not be verified."));
    }

    const authMethodPolicy = evaluateAuthenticationMethods(
      claimsResult.data.claims.amr,
      allowedAuthMethods
    );
    if (!authMethodPolicy.allowed) {
      return next(new HttpError(
        403,
        "Use the approved WESCOMM passwordless sign-in method.",
        "AUTH_METHOD_NOT_ALLOWED"
      ));
    }

    const allowedProviders = normalizeCsv(env.AUTH_ALLOWED_AUTH_PROVIDERS);
    const metadata = data.user.app_metadata as Record<string, unknown>;
    const primaryProvider = String(metadata.provider ?? "").toLowerCase();
    const linkedProviders = Array.isArray(metadata.providers)
      ? metadata.providers.map((provider) => String(provider).toLowerCase())
      : [];
    const providerAllowed =
      allowedProviders.includes("*") ||
      allowedProviders.some((provider) => primaryProvider === provider || linkedProviders.includes(provider));

    if (!providerAllowed) {
      return next(new HttpError(403, "Use the approved WESCOMM email sign-in method."));
    }

    const email = data.user.email.toLowerCase();
    const isAllowedEmail = isEmailAllowedForDomains(email, allowedEmailDomains);
    if (!isAllowedEmail) {
      return next(approvedSchoolEmailError());
    }

    let profile = await loadProfileById(data.user.id);

    if (!profile) {
      const userMetadata = data.user.user_metadata as Record<string, unknown>;
      const fullName =
        String(userMetadata.full_name ?? userMetadata.name ?? data.user.email?.split("@")[0] ?? "").trim() ||
        data.user.email;

      const { data: createdProfileRow, error: createProfileError } = await supabaseAdmin
        .from("profiles")
        .insert({
          id: data.user.id,
          email,
          full_name: fullName,
          role: "STUDENT"
        })
        .select("*")
        .single();

      if (createProfileError) return next(new HttpError(500, createProfileError.message));
      profile = mapProfile(createdProfileRow as RawProfile);
    } else if (profile.email.toLowerCase() !== email) {
      const { data: updatedProfileRow, error: updateProfileError } = await supabaseAdmin
        .from("profiles")
        .update({ email, updated_at: new Date().toISOString() })
        .eq("id", data.user.id)
        .select("*")
        .single();

      if (updateProfileError) {
        if (updateProfileError.code === "23505") {
          return next(new HttpError(409, "This school email is already linked to another account."));
        }
        return next(new HttpError(500, updateProfileError.message));
      }

      await revokeAuthSessionsForUser(data.user.id);
      clearAuthSessionCookie(response);
      profile = mapProfile(updatedProfileRow as RawProfile);
    }

    if (!profile) return next(new HttpError(403, "User profile was not found."));

    request.auth = {
      id: profile.id,
      email: profile.email,
      role: profile.role,
      profile,
      method: "BEARER"
    };

    return next();
  } catch (error) {
    return next(error);
  }
}
