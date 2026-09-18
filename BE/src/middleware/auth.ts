import type { Request, RequestHandler, Response } from "express";
import { config } from "../config.js";
import { HttpError } from "./error-handler.js";
import { resolveSession, type AuthenticatedUser } from "../auth/store.js";
import { hasPermission, type Permission } from "../auth/permissions.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
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
 * Session gates. Staff and complainants share one account table, one sign-in
 * and this one cookie (§8 decision 15); what a session may do comes from its
 * role's permissions (src/auth/permissions.ts), never from "is signed in".
 *
 *   requireSignedIn()                       any active, signed-in account
 *   requirePermission("complaints.manage")  only roles holding it
 *
 * Never gate a data route on requireSignedIn() alone: a PENGADU is signed in
 * too. /api/admin/* uses Integrity Unit permissions (rules 2 and 9).
 *
 * 401 = not signed in (or session expired/revoked). 403 = signed in, not allowed.
 */
function gate(permission: Permission | null): RequestHandler {
  return async (req, res, next) => {
    try {
      const token = readSessionToken(req);
      if (!token) {
        return next(new HttpError(401, "Sila log masuk"));
      }

      const user = await resolveSession(token, config.auth.idleTimeoutMinutes);
      if (!user) {
        clearSessionCookie(res);
        return next(
          new HttpError(
            401,
            "Sesi tamat atau tidak sah — sila log masuk semula",
          ),
        );
      }

      if (permission && !hasPermission(user.role, permission)) {
        return next(new HttpError(403, "Peranan anda tidak dibenarkan"));
      }

      req.user = user;
      req.sessionToken = token;
      next();
    } catch (err) {
      next(err);
    }
  };
}

export const requireSignedIn = (): RequestHandler => gate(null);

export const requirePermission = (permission: Permission): RequestHandler =>
  gate(permission);
