import type { NextFunction, Response } from "express";
import type { AppRole } from "../types/app.js";
import type { AuthenticatedRequest } from "./auth.js";
import { HttpError } from "../utils/http-error.js";

export function requireRole(...roles: AppRole[]) {
  return (request: AuthenticatedRequest, _response: Response, next: NextFunction) => {
    if (!request.auth) return next(new HttpError(401, "Authentication required."));
    if (!roles.includes(request.auth.role)) return next(new HttpError(403, "You do not have access to this resource."));
    return next();
  };
}
