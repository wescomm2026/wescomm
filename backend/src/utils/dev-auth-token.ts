import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";

type DevAuthPayload = {
  typ: "dev-login";
  sub: string;
  email: string;
  exp: number;
};

function encodeBase64Url(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

function signPayload(encodedPayload: string) {
  return createHmac("sha256", env.SUPABASE_SERVICE_ROLE_KEY)
    .update(encodedPayload)
    .digest("base64url");
}

function signaturesMatch(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function createDevAuthToken(input: { id: string; email: string }) {
  const payload: DevAuthPayload = {
    typ: "dev-login",
    sub: input.id,
    email: input.email.toLowerCase(),
    exp: Math.floor(Date.now() / 1000) + 8 * 60 * 60
  };

  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  return `dev.${encodedPayload}.${signPayload(encodedPayload)}`;
}

export function verifyDevAuthToken(token: string) {
  const [prefix, encodedPayload, signature] = token.split(".");
  if (prefix !== "dev" || !encodedPayload || !signature) return null;
  if (!signaturesMatch(signature, signPayload(encodedPayload))) return null;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as DevAuthPayload;
    if (payload.typ !== "dev-login") return null;
    if (!payload.sub || !payload.email) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
