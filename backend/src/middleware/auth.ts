import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";
import { supabaseAdmin } from "../lib/supabase.js";
import {
  clearAuthSessionCookie,
  readAuthSessionToken,
  resolveAuthSession
} from "../services/auth-session.service.js";
import { type AppRole, type Profile, type RawProfile, mapProfile } from "../types/app.js";
import { HttpError } from "../utils/http-error.js";
import { verifyDevAuthToken } from "../utils/dev-auth-token.js";

export type AuthContext = {
  id: string;
  email: string;
  role: AppRole;
  profile: Profile;
  method: "COOKIE" | "BEARER" | "DEV_BEARER";
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

    if (token.startsWith("dev.")) {
      if (!env.AUTH_ENABLE_DEV_LOGIN) return next(new HttpError(401, "Development login is disabled."));

      const payload = verifyDevAuthToken(token);
      if (!payload) return next(new HttpError(401, "Invalid or expired development token."));

      const profile = await loadProfileById(payload.sub);
      if (!profile || profile.email.toLowerCase() !== payload.email.toLowerCase()) {
        return next(new HttpError(401, "Development login profile was not found."));
      }

      request.auth = {
        id: profile.id,
        email: profile.email,
        role: profile.role,
        profile,
        method: "DEV_BEARER"
      };

      return next();
    }

    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data.user?.email) return next(new HttpError(401, "Invalid or expired token."));

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
    const allowedDomains = normalizeCsv(env.AUTH_ALLOWED_EMAIL_DOMAINS);

    const allowsAnyDomain = allowedDomains.length === 0 || allowedDomains.includes("*");
    const isAllowedEmail = allowsAnyDomain || allowedDomains.some((domain) => email.endsWith(`@${domain}`));
    if (!isAllowedEmail) {
      return next(new HttpError(403, `Use an approved school account email domain: ${allowedDomains.join(", ")}.`));
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
