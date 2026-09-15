import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { HttpError } from "../middleware/error-handler.js";
import {
  clearSessionCookie,
  readSessionToken,
  requireStaff,
  setSessionCookie,
} from "../middleware/auth.js";
import {
  checkPasswordPolicy,
  getDummyHash,
  hashPassword,
  MAX_PASSWORD_LENGTH,
  verifyPassword,
} from "../auth/password.js";
import {
  createSession,
  deleteSession,
  getCredentialsByEmail,
  recordFailedLogin,
  recordSuccessfulLogin,
  setPassword,
} from "../auth/store.js";
import { INTEGRITY_UNIT_ROLES } from "../auth/roles.js";

export const authRouter: Router = Router();

const loginSchema = z.object({
  email: z.string().trim().min(3).max(320),
  // Capped before hashing so a multi-megabyte "password" can't be used to burn
  // CPU in scrypt.
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH),
  newPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH),
});

/**
 * One message for every failure mode — unknown email, wrong password, inactive
 * account, no password set. Distinguishing them tells an attacker which staff
 * emails are real. Lockout is the one exception, and it is only reported after
 * the password has been verified, so it can't be used as an oracle either.
 */
const INVALID_CREDENTIALS = "E-mel atau kata laluan tidak sah";

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, INVALID_CREDENTIALS);

  const { email, password } = parsed.data;
  const staff = await getCredentialsByEmail(email);

  // Always pay for one scrypt, so response time doesn't reveal whether the
  // email exists or has a password set.
  const passwordOk = await verifyPassword(
    password,
    staff?.password_hash ?? (await getDummyHash()),
  );

  if (!staff || !staff.password_hash || !staff.is_active) {
    throw new HttpError(401, INVALID_CREDENTIALS);
  }

  const locked = staff.locked_until !== null && staff.locked_until > new Date();

  if (!passwordOk) {
    // Failures during a lockout don't extend it — otherwise anyone who knows a
    // staff email could keep that person locked out indefinitely.
    if (!locked) {
      await recordFailedLogin(
        staff.id,
        config.auth.maxFailedLogins,
        config.auth.lockoutMinutes,
      );
    }
    throw new HttpError(401, INVALID_CREDENTIALS);
  }

  if (locked) {
    throw new HttpError(
      423,
      "Akaun dikunci sementara kerana terlalu banyak cubaan gagal. Cuba lagi kemudian.",
    );
  }

  await recordSuccessfulLogin(staff.id);

  // Rotate on login: any pre-existing cookie is dropped, never promoted.
  const previous = readSessionToken(req);
  if (previous) await deleteSession(previous);

  const { token, expiresAt } = await createSession({
    staffId: staff.id,
    ttlMinutes: config.auth.sessionTtlMinutes,
    ip: req.ip,
    userAgent: req.header("User-Agent"),
  });

  setSessionCookie(res, token, expiresAt);

  res.json({
    data: {
      id: staff.id,
      email: staff.email,
      fullName: staff.full_name,
      role: staff.role,
      isIntegrityUnit: (INTEGRITY_UNIT_ROLES as readonly string[]).includes(
        staff.role,
      ),
      sessionExpiresAt: expiresAt,
    },
  });
});

authRouter.post("/logout", async (req, res) => {
  const token = readSessionToken(req);
  if (token) await deleteSession(token);
  clearSessionCookie(res);
  res.status(204).end();
});

authRouter.get("/me", requireStaff(), (req, res) => {
  const staff = req.staff!;
  res.json({
    data: {
      ...staff,
      isIntegrityUnit: (INTEGRITY_UNIT_ROLES as readonly string[]).includes(
        staff.role,
      ),
    },
  });
});

/**
 * Change own password. Requires the current password even with a valid
 * session, so a hijacked or unattended session can't be used to take over the
 * account. Signs out every OTHER session.
 */
authRouter.post("/password", requireStaff(), async (req, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(422, z.prettifyError(parsed.error));
  }

  const staff = req.staff!;
  const credentials = await getCredentialsByEmail(staff.email);
  const ok =
    credentials?.password_hash &&
    (await verifyPassword(
      parsed.data.currentPassword,
      credentials.password_hash,
    ));

  if (!ok) throw new HttpError(401, "Kata laluan semasa tidak sah");

  const policyError = checkPasswordPolicy(parsed.data.newPassword);
  if (policyError) throw new HttpError(422, policyError);

  await setPassword(
    staff.id,
    await hashPassword(parsed.data.newPassword),
    req.sessionToken,
  );

  res.status(204).end();
});
