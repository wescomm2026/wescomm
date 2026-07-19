import type { NextFunction, Response } from "express";
import type { AuthenticatedRequest } from "./auth.js";
import { HttpError } from "../utils/http-error.js";

export function requireBearerSessionExchange(
  request: AuthenticatedRequest,
  _response: Response,
  next: NextFunction
) {
  if (request.auth?.method !== "BEARER") {
    return next(new HttpError(
      403,
      "A verified passwordless sign-in is required to create a standard session.",
      "BEARER_SESSION_REQUIRED"
    ));
  }
  return next();
}
