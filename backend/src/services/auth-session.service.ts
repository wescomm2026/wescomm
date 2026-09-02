import { createHash, randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { env } from "../config/env.js";
import {
  assertCurrentAccountPolicyAcceptance,
  type SubmittedPolicyAcceptance
} from "../domain/policy-acceptance.js";
import {
  isTemporaryProductionStaffIdentity,
  temporaryStaffLoginExpirationMs
} from "../domain/temporary-staff-login-policy.js";
import { prisma } from "../lib/prisma.js";
import type { AppRole, Profile } from "../types/app.js";
import { decryptSensitiveText } from "../utils/field-encryption.js";
import { HttpError } from "../utils/http-error.js";
import {
  isTransientPrismaConnectionError,
  withTransientPrismaReadRetry
} from "../utils/prisma-retry.js";

const DEVELOPMENT_COOKIE_NAME = "wescomm_session";
const PRODUCTION_COOKIE_NAME = "__Host-wescomm_session";
const LAST_SEEN_WRITE_INTERVAL_MS = 15 * 60 * 1000;
const TEMPORARY_STAFF_SESSION_TOKEN_PREFIX = "tmp_staff.";

type ResolvedAuthSession = {
  sessionId: string;
  profile: Profile;
} | null;

// Initial page load opens several authenticated requests at once (page data,
// notifications, restrictions and realtime). Share only the in-flight lookup;
// completed results are not cached, so logout/revocation stays immediate.
const pendingSessionResolutions = new Map<string, Promise<ResolvedAuthSession>>();

export type AuthSessionKind = "STANDARD" | "TEMPORARY_STAFF";

export const AUTH_SESSION_TRANSACTION_OPTIONS = Object.freeze({
  maxWait: 10_000,
  timeout: 20_000
});

export function authSessionExpiration(
  now: Date,
  ttlHours: number,
  maximumExpiresAt?: Date
) {
  const configuredExpirationMs = now.getTime() + ttlHours * 60 * 60 * 1000;
  const expiresAtMs = maximumExpiresAt
    ? Math.min(configuredExpirationMs, maximumExpiresAt.getTime())
    : configuredExpirationMs;
  return new Date(expiresAtMs);
}

export function authSessionIssueError(error: unknown) {
  if (isTransientPrismaConnectionError(error)) {
    return new HttpError(
      503,
      "Sign-in is temporarily unavailable. Please try again.",
      "AUTH_SESSION_UNAVAILABLE",
      { retryable: true }
    );
  }
  return error;
}

export function isTemporaryStaffSessionToken(rawToken: string) {
  return rawToken.startsWith(TEMPORARY_STAFF_SESSION_TOKEN_PREFIX);
}

export function isAuthSessionProfileAllowed(
  rawToken: string,
  profile: { email: string; role: string },
  temporaryStaffGateActive: boolean
) {
  if (!isTemporaryStaffSessionToken(rawToken)) return true;
  return temporaryStaffGateActive
    && isTemporaryProductionStaffIdentity(profile.email, profile.role);
}

function cookieName() {
  return env.NODE_ENV === "production" ? PRODUCTION_COOKIE_NAME : DEVELOPMENT_COOKIE_NAME;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function parseCookieHeader(header: string | undefined) {
  const cookies = new Map<string, string>();
  for (const item of (header ?? "").split(";")) {
    const separator = item.indexOf("=");
    if (separator <= 0) continue;
    const name = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    if (name) cookies.set(name, decodeURIComponent(value));
  }
  return cookies;
}

function serializeCookie(value: string, maxAgeSeconds: number) {
  const attributes = [
    `${cookieName()}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`
  ];
  if (env.NODE_ENV === "production") attributes.push("Secure");
  return attributes.join("; ");
}

function mapSessionProfile(row: {
  id: string;
  fullName: string;
  email: string;
  studentNumber: string | null;
  phone: string | null;
  department: string | null;
  address: string | null;
  role: AppRole;
  avatarUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}): Profile {
  return {
    id: row.id,
    fullName: row.fullName,
    email: row.email,
    studentNumber: row.studentNumber,
    phone: decryptSensitiveText(row.phone, "profile.phone"),
    department: row.department,
    address: decryptSensitiveText(row.address, "profile.address"),
    role: row.role,
    avatarUrl: row.avatarUrl,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

export function readAuthSessionToken(request: Request) {
  return parseCookieHeader(request.headers.cookie).get(cookieName()) ?? null;
}

export function clearAuthSessionCookie(response: Response) {
  response.append("Set-Cookie", serializeCookie("", 0));
}

export async function issueAuthSession(input: {
  request: Request;
  response: Response;
  userId: string;
  policyAcceptance?: SubmittedPolicyAcceptance;
  maximumExpiresAt?: Date;
  kind?: AuthSessionKind;
}) {
  const policyVersion = assertCurrentAccountPolicyAcceptance(input.policyAcceptance);
  const tokenEntropy = randomBytes(32).toString("base64url");
  const rawToken = input.kind === "TEMPORARY_STAFF"
    ? `${TEMPORARY_STAFF_SESSION_TOKEN_PREFIX}${tokenEntropy}`
    : tokenEntropy;
  const now = new Date();
  const expiresAt = authSessionExpiration(now, env.AUTH_SESSION_TTL_HOURS, input.maximumExpiresAt);
  if (expiresAt.getTime() <= now.getTime()) {
    throw new HttpError(403, "The temporary login window has expired.");
  }
  const userAgent = String(input.request.get("user-agent") ?? "").slice(0, 500) || null;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.authSession.deleteMany({
        where: {
          OR: [
            { expiresAt: { lte: now } },
            { revokedAt: { not: null }, createdAt: { lt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) } }
          ]
        }
      });

      const activeSessions = await tx.authSession.findMany({
        where: { userId: input.userId, revokedAt: null, expiresAt: { gt: now } },
        orderBy: { createdAt: "desc" },
        select: { id: true }
      });
      const sessionsToRevoke = activeSessions.slice(Math.max(0, env.AUTH_SESSION_MAX_PER_USER - 1));
      if (sessionsToRevoke.length) {
        await tx.authSession.updateMany({
          where: { id: { in: sessionsToRevoke.map((session) => session.id) } },
          data: { revokedAt: now }
        });
      }

      await tx.authSession.create({
        data: {
          userId: input.userId,
          tokenHash: hashToken(rawToken),
          userAgent,
          expiresAt
        }
      });
      await tx.policyAcceptance.createMany({
        data: [{
          userId: input.userId,
          policyVersion,
          acceptedAt: now
        }],
        skipDuplicates: true
      });
    }, AUTH_SESSION_TRANSACTION_OPTIONS);
  } catch (error) {
    // Retrying a write transaction after an ambiguous connection failure can
    // create duplicate sessions. Return a retryable response to the client
    // instead and let a fresh sign-in attempt create a new bounded session.
    throw authSessionIssueError(error);
  }

  input.response.append(
    "Set-Cookie",
    serializeCookie(rawToken, (expiresAt.getTime() - now.getTime()) / 1000)
  );
}

async function resolveAuthSessionUncached(rawToken: string, tokenHash: string): Promise<ResolvedAuthSession> {
  const now = new Date();
  const session = await withTransientPrismaReadRetry(() => prisma.authSession.findUnique({
    where: { tokenHash },
    include: { user: true },
    relationLoadStrategy: "join"
  }));

  if (!session || session.revokedAt || session.expiresAt <= now) return null;
  if (!isAuthSessionProfileAllowed(
    rawToken,
    session.user,
    Boolean(temporaryStaffLoginExpirationMs(env, now.getTime()))
  )) {
    return null;
  }

  if (now.getTime() - session.lastSeenAt.getTime() >= LAST_SEEN_WRITE_INTERVAL_MS) {
    try {
      await prisma.authSession.update({
        where: { id: session.id },
        data: { lastSeenAt: now }
      });
    } catch (error) {
      // Activity telemetry must not invalidate an otherwise verified session
      // during a brief database connection or pool-acquisition failure.
      if (!isTransientPrismaConnectionError(error)) throw error;
    }
  }

  return {
    sessionId: session.id,
    profile: mapSessionProfile(session.user as Parameters<typeof mapSessionProfile>[0])
  };
}

export async function resolveAuthSession(rawToken: string): Promise<ResolvedAuthSession> {
  const tokenHash = hashToken(rawToken);
  const pending = pendingSessionResolutions.get(tokenHash);
  if (pending) return pending;

  const resolution = resolveAuthSessionUncached(rawToken, tokenHash).finally(() => {
    if (pendingSessionResolutions.get(tokenHash) === resolution) {
      pendingSessionResolutions.delete(tokenHash);
    }
  });
  pendingSessionResolutions.set(tokenHash, resolution);
  return resolution;
}

export async function revokeAuthSession(rawToken: string | null) {
  if (!rawToken) return;
  await prisma.authSession.updateMany({
    where: { tokenHash: hashToken(rawToken), revokedAt: null },
    data: { revokedAt: new Date() }
  });
}

export async function revokeAuthSessionsForUser(userId: string) {
  await prisma.authSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() }
  });
}
