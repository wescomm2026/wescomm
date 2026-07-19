import { createHash, randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import type { AppRole, Profile } from "../types/app.js";
import { decryptSensitiveText } from "../utils/field-encryption.js";
import {
  isTransientPrismaConnectionError,
  withTransientPrismaReadRetry
} from "../utils/prisma-retry.js";

const DEVELOPMENT_COOKIE_NAME = "wescomm_session";
const PRODUCTION_COOKIE_NAME = "__Host-wescomm_session";
const LAST_SEEN_WRITE_INTERVAL_MS = 15 * 60 * 1000;

export const AUTH_SESSION_TRANSACTION_OPTIONS = Object.freeze({
  maxWait: 10_000,
  timeout: 20_000
});

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
}) {
  const rawToken = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + env.AUTH_SESSION_TTL_HOURS * 60 * 60 * 1000);
  const userAgent = String(input.request.get("user-agent") ?? "").slice(0, 500) || null;

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
  }, AUTH_SESSION_TRANSACTION_OPTIONS);

  input.response.append(
    "Set-Cookie",
    serializeCookie(rawToken, env.AUTH_SESSION_TTL_HOURS * 60 * 60)
  );
}

export async function resolveAuthSession(rawToken: string) {
  const now = new Date();
  const session = await withTransientPrismaReadRetry(() => prisma.authSession.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { user: true }
  }));

  if (!session || session.revokedAt || session.expiresAt <= now) return null;

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
