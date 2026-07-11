import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";
import { isTrustedCookieRequest } from "../domain/request-security.js";
import { readAuthSessionToken } from "../services/auth-session.service.js";
import { HttpError } from "../utils/http-error.js";

const allowedOrigins = new Set(
  env.FRONTEND_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean)
);

export function requireTrustedCookieOrigin(request: Request, _response: Response, next: NextFunction) {
  const origin = request.get("origin");
  const fetchSite = request.get("sec-fetch-site");
  if (!isTrustedCookieRequest({
    method: request.method,
    hasAuthorizationHeader: Boolean(request.headers.authorization),
    hasSessionCookie: Boolean(readAuthSessionToken(request)),
    origin,
    fetchSite
  }, allowedOrigins)) {
    return next(new HttpError(403, "This request did not come from an approved WESCOMM page."));
  }

  return next();
}
