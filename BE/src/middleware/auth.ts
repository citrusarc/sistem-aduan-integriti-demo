import type { Request, RequestHandler, Response } from "express";
import { config } from "../config.js";
import { HttpError } from "./error-handler.js";
import { resolveSession, type AuthenticatedStaff } from "../auth/store.js";
import type { StaffRole } from "../types/enums.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      staff?: AuthenticatedStaff;
      sessionToken?: string;
    }
  }
}

export function readSessionToken(req: Request): string | undefined {
  const token: unknown = req.cookies?.[config.auth.cookieName];
  return typeof token === "string" && token.length > 0 ? token : undefined;
}

export function setSessionCookie(
  res: Response,
  token: string,
  expiresAt: Date,
): void {
  res.cookie(config.auth.cookieName, token, {
    httpOnly: true,
    secure: config.auth.cookieSecure,
    sameSite: config.auth.cookieSameSite,
    path: "/api",
    expires: expiresAt,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(config.auth.cookieName, {
    httpOnly: true,
    secure: config.auth.cookieSecure,
    sameSite: config.auth.cookieSameSite,
    path: "/api",
  });
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF defence for cookie-authenticated writes. Browsers always send `Origin`
 * on cross-origin POST/PATCH/DELETE, so a state-changing request whose Origin
 * isn't one of our frontends is refused. A request with no Origin at all comes
 * from a non-browser client (curl, a server), which can't carry a victim's
 * cookie in the first place, so it is allowed.
 *
 * SameSite=Lax already blocks the classic cross-site form POST; this covers
 * SameSite=None deployments and same-site-but-different-origin attackers.
 */
export const requireTrustedOrigin: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();

  const origin = req.header("Origin");
  if (origin && !config.corsOrigins.includes(origin)) {
    return next(new HttpError(403, "Asal permintaan tidak dibenarkan"));
  }
  next();
};

/**
 * Session gate for staff routes.
 *
 *   requireStaff()                         any active, logged-in staff
 *   requireStaff(...INTEGRITY_UNIT_ROLES)  only those roles
 *
 * Every /api/admin/* router passes INTEGRITY_UNIT_ROLES. Do not mount one with
 * a bare requireStaff(): KJ and SUB_UNIT are staff, but outside the Integrity
 * Unit, and must not see the case register (rules 2 and 9).
 *
 * 401 = not signed in (or session expired/revoked). 403 = signed in, wrong role.
 */
export function requireStaff(...allowed: readonly StaffRole[]): RequestHandler {
  return async (req, res, next) => {
    try {
      const token = readSessionToken(req);
      if (!token) {
        return next(new HttpError(401, "Sila log masuk"));
      }

      const staff = await resolveSession(token, config.auth.idleTimeoutMinutes);
      if (!staff) {
        clearSessionCookie(res);
        return next(
          new HttpError(
            401,
            "Sesi tamat atau tidak sah — sila log masuk semula",
          ),
        );
      }

      if (allowed.length && !allowed.includes(staff.role)) {
        return next(new HttpError(403, "Peranan anda tidak dibenarkan"));
      }

      req.staff = staff;
      req.sessionToken = token;
      next();
    } catch (err) {
      next(err);
    }
  };
}
