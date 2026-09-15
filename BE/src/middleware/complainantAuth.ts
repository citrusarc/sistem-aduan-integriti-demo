import type { Request, RequestHandler, Response } from "express";
import { config } from "../config.js";
import { HttpError } from "./error-handler.js";
import {
  resolveComplainantSession,
  type AuthenticatedComplainant,
} from "../auth/complainantStore.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      complainant?: AuthenticatedComplainant;
      complainantSessionToken?: string;
    }
  }
}

/**
 * Complainant sessions — §8 decision 4. A separate cookie from staff
 * (`aduan_csid` vs `aduan_sid`), resolved against a separate table: a
 * complainant cookie never opens a staff route, and a staff cookie never opens
 * a complainant one.
 */

const cookieOptions = () => ({
  httpOnly: true,
  secure: config.auth.cookieSecure,
  sameSite: config.auth.cookieSameSite,
  path: "/api",
});

export function readComplainantToken(req: Request): string | undefined {
  const token: unknown = req.cookies?.[config.complainantAuth.cookieName];
  return typeof token === "string" && token.length > 0 ? token : undefined;
}

export function setComplainantCookie(
  res: Response,
  token: string,
  expiresAt: Date,
): void {
  res.cookie(config.complainantAuth.cookieName, token, {
    ...cookieOptions(),
    expires: expiresAt,
  });
}

export function clearComplainantCookie(res: Response): void {
  res.clearCookie(config.complainantAuth.cookieName, cookieOptions());
}

export const requireComplainant: RequestHandler = async (req, res, next) => {
  try {
    const token = readComplainantToken(req);
    if (!token) return next(new HttpError(401, "Sila log masuk"));

    const complainant = await resolveComplainantSession(
      token,
      config.complainantAuth.idleTimeoutMinutes,
    );
    if (!complainant) {
      clearComplainantCookie(res);
      return next(
        new HttpError(401, "Sesi tamat atau tidak sah — sila log masuk semula"),
      );
    }

    req.complainant = complainant;
    req.complainantSessionToken = token;
    next();
  } catch (err) {
    next(err);
  }
};
