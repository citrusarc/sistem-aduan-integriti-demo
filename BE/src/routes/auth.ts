import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { HttpError } from "../middleware/error-handler.js";
import {
  clearSessionCookie,
  readSessionToken,
  requireSignedIn,
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
  consumeAuthChallenge,
  createAuthChallenge,
  createSession,
  deleteAllSessionsForStaff,
  deleteSession,
  getCredentialsByEmail,
  getCredentialsById,
  markEmailVerified,
  peekAuthChallengeStaff,
  promoteInitialAdmin,
  registerAccount,
  recordFailedLogin,
  recordSuccessfulLogin,
  setPassword,
  STAFF_CODE_DIGITS,
  verifyAuthChallengeCode,
} from "../auth/store.js";
import {
  consumeCaptchaPass,
  createCaptcha,
  solveCaptcha,
} from "../auth/captcha.js";
import { isIntegrityUnitRole } from "../auth/roles.js";
import { hasConsoleAccess, ROLE_PERMISSIONS } from "../auth/permissions.js";
import { notifyByEmail } from "../notify/email.js";
import type { StaffRole } from "../types/enums.js";

/**
 * Sign-in and registration for every account — staff and complainants alike
 * (§8 decisions 14 and 15). One page, one cookie; the role decides the rest.
 *
 *   POST /register                name + email + password + captchaToken
 *                                   -> verifyToken; a code is emailed
 *   POST /register/verify         verifyToken + code -> session
 *
 *   GET  /captcha                 slider picture
 *   POST /captcha/verify          slide -> captchaToken (one use)
 *   POST /login                   email + password + captchaToken
 *                                   -> mfaToken; a code is emailed
 *   POST /login/verify            mfaToken + code
 *                                   -> session, or changeToken when the
 *                                      password expired / was set by ADMIN
 *   POST /password/expired        changeToken + newPassword -> session
 *   POST /forgot-password         email + captchaToken -> resetToken; a code
 *                                   is emailed if the account exists
 *   POST /reset-password          resetToken + code + newPassword
 *
 * No step reveals whether an email has an account: unknown emails get the
 * same answers, tokens that look the same, and cost the same scrypt. Codes go
 * by email only (rule 10) — printed to this terminal locally.
 */
export const authRouter: Router = Router();

const email = z.string().trim().min(3).max(320);
// Capped before hashing so a multi-megabyte "password" can't burn CPU in scrypt.
const password = z.string().min(1).max(MAX_PASSWORD_LENGTH);
const token = z.string().min(10).max(200);
const code = z
  .string()
  .trim()
  .regex(new RegExp(`^\\d{${STAFF_CODE_DIGITS}}$`));

const loginSchema = z.object({ email, password, captchaToken: token });
const registerSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, "Nama mesti sekurang-kurangnya 2 aksara")
    .max(200),
  email: z.string().trim().max(254).pipe(z.email("Alamat e-mel tidak sah")),
  password,
  captchaToken: token,
});
const changePasswordSchema = z.object({
  currentPassword: password,
  newPassword: password,
});

/**
 * One message for every failure mode — unknown email, wrong password, inactive
 * account, no password set. Distinguishing them tells an attacker which staff
 * emails are real. The block is the one exception, and it is only reported
 * after the password has been verified, so it can't be used as an oracle.
 */
const INVALID_CREDENTIALS = "E-mel atau kata laluan tidak sah";
const CAPTCHA_REQUIRED =
  "Sahkan captcha sebelum log masuk. Muat semula captcha jika telah tamat tempoh.";
const INVALID_CODE =
  "Kod tidak sah, telah digunakan, atau telah tamat tempoh. Log masuk semula untuk mendapatkan kod baharu.";
const EMAIL_NOT_VERIFIED =
  "E-mel akaun ini belum disahkan. Daftar semula dengan e-mel yang sama untuk mendapatkan kod pengesahan baharu.";
const ACCOUNT_BLOCKED =
  'Akaun disekat selepas 5 cubaan kata laluan yang gagal. Gunakan "Lupa kata laluan" atau hubungi ADMIN untuk membukanya.';

/** a****@contoh.gov.my — enough to recognise, not to harvest. */
function maskEmail(address: string): string {
  const [local = "", domain = ""] = address.split("@");
  return `${local.slice(0, 1)}${"*".repeat(Math.max(3, local.length - 1))}@${domain}`;
}

function sendCode(to: string, subject: string, intro: string, value: string) {
  void notifyByEmail({
    to,
    subject,
    text: [
      intro,
      "",
      `Kod: ${value}`,
      "",
      `Kod ini sah selama ${config.auth.codeTtlMinutes} minit dan hanya boleh digunakan sekali.`,
      "Jika anda tidak meminta kod ini, abaikan e-mel ini dan maklumkan ADMIN.",
    ].join("\n"),
  }).catch((err: unknown) => {
    console.error("Gagal menghantar kod kakitangan:", err);
  });
}

type SignedIn = {
  id: string;
  email: string;
  full_name: string;
  role: StaffRole;
};

/**
 * What the FE learns about the signed-in account. `permissions` decides what
 * it SHOWS; BE checks the permission again on every request.
 */
function describeUser(user: {
  id: string;
  email: string;
  fullName: string;
  role: StaffRole;
  sessionExpiresAt: Date;
}) {
  return {
    ...user,
    permissions: ROLE_PERMISSIONS[user.role],
    isIntegrityUnit: isIntegrityUnitRole(user.role),
    hasConsole: hasConsoleAccess(user.role),
  };
}

async function startSession(req: Request, res: Response, signedIn: SignedIn) {
  // §8 decision 15: the address has just been proven by an emailed code.
  const promoted = await promoteInitialAdmin(
    signedIn.id,
    config.initialAdminEmail,
  );
  if (promoted) {
    console.log(`[Akaun] ADMIN pertama: ${signedIn.email}`);
  }
  const staff = promoted ? { ...signedIn, role: "ADMIN" as const } : signedIn;
  await recordSuccessfulLogin(staff.id);

  // Rotate on login: any pre-existing cookie is dropped, never promoted.
  const previous = readSessionToken(req);
  if (previous) await deleteSession(previous);

  const { token: sessionToken, expiresAt } = await createSession({
    staffId: staff.id,
    ttlMinutes: config.auth.sessionTtlMinutes,
    ip: req.ip,
    userAgent: req.header("User-Agent"),
  });
  setSessionCookie(res, sessionToken, expiresAt);

  return describeUser({
    id: staff.id,
    email: staff.email,
    fullName: staff.full_name,
    role: staff.role,
    sessionExpiresAt: expiresAt,
  });
}

/** (b) + never the same password again. Throws 422 with the reason. */
async function checkNewPassword(
  newPassword: string,
  currentHash: string | null,
) {
  const policyError = checkPasswordPolicy(newPassword);
  if (policyError) throw new HttpError(422, policyError);
  if (currentHash && (await verifyPassword(newPassword, currentHash))) {
    throw new HttpError(
      422,
      "Kata laluan baharu mesti berbeza daripada kata laluan semasa",
    );
  }
}

// ─── Captcha ─────────────────────────────────────────────────────────────────

authRouter.get("/captcha", async (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ data: await createCaptcha() });
});

authRouter.post("/captcha/verify", async (req, res) => {
  const parsed = z
    .object({ challengeToken: token, x: z.number().int().min(0).max(1000) })
    .safeParse(req.body);
  if (!parsed.success) throw new HttpError(422, "Captcha tidak sah");

  const result = await solveCaptcha(parsed.data.challengeToken, parsed.data.x);
  if (!result.solved) {
    res.status(422).json({
      error: result.retry
        ? "Kepingan tidak sepadan. Cuba lagi."
        : "Captcha tamat tempoh atau terlalu banyak cubaan. Muat semula captcha.",
      retry: result.retry,
    });
    return;
  }
  res.json({ data: { captchaToken: result.passToken } });
});

// ─── Login: password, then emailed code ──────────────────────────────────────

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(
      400,
      parsed.error.issues.some((i) => i.path[0] === "captchaToken")
        ? CAPTCHA_REQUIRED
        : INVALID_CREDENTIALS,
    );
  }

  // (g) The captcha is spent before the password is looked at, so each guess
  // costs a solved slider.
  if (!(await consumeCaptchaPass(parsed.data.captchaToken))) {
    throw new HttpError(400, CAPTCHA_REQUIRED);
  }

  const staff = await getCredentialsByEmail(parsed.data.email);

  // Always pay for one scrypt, so response time doesn't reveal whether the
  // email exists or has a password set.
  const passwordOk = await verifyPassword(
    parsed.data.password,
    staff?.password_hash ?? (await getDummyHash()),
  );

  if (!staff || !staff.password_hash || !staff.is_active) {
    throw new HttpError(401, INVALID_CREDENTIALS);
  }

  const locked = staff.locked_until !== null && staff.locked_until > new Date();

  if (!passwordOk) {
    // (d) Failures while blocked don't count further; the block already holds.
    if (!locked) await recordFailedLogin(staff.id, config.auth.maxFailedLogins);
    throw new HttpError(401, INVALID_CREDENTIALS);
  }

  if (locked) throw new HttpError(423, ACCOUNT_BLOCKED);
  // Only a self-registration can be unverified; said only after the password.
  if (!staff.email_verified_at) throw new HttpError(403, EMAIL_NOT_VERIFIED);

  // (a) MFA: the password alone never opens a session.
  const challenge = await createAuthChallenge({
    staffId: staff.id,
    purpose: "LOGIN_MFA",
    ttlMinutes: config.auth.codeTtlMinutes,
    withCode: true,
  });
  sendCode(
    staff.email,
    "Kod pengesahan log masuk Sistem Aduan Integriti",
    `Seseorang (diharap anda) telah memasukkan kata laluan yang betul untuk akaun ${staff.email}.`,
    challenge.code!,
  );

  res.json({
    data: {
      mfaRequired: true,
      mfaToken: challenge.token,
      sentTo: maskEmail(staff.email),
    },
  });
});

authRouter.post("/login/verify", async (req, res) => {
  const parsed = z.object({ mfaToken: token, code }).safeParse(req.body);
  if (!parsed.success) throw new HttpError(401, INVALID_CODE);

  const staffId = await verifyAuthChallengeCode(
    parsed.data.mfaToken,
    "LOGIN_MFA",
    parsed.data.code,
  );
  const staff = staffId ? await getCredentialsById(staffId) : undefined;
  if (!staff || !staff.is_active) throw new HttpError(401, INVALID_CODE);
  if (staff.locked_until !== null && staff.locked_until > new Date()) {
    throw new HttpError(423, ACCOUNT_BLOCKED);
  }

  // (c) Expired, or set by ADMIN: no session until it's replaced.
  if (staff.password_change_required) {
    const change = await createAuthChallenge({
      staffId: staff.id,
      purpose: "PASSWORD_CHANGE",
      ttlMinutes: config.auth.codeTtlMinutes,
      withCode: false,
    });
    res.json({
      data: { passwordChangeRequired: true, changeToken: change.token },
    });
    return;
  }

  res.json({ data: await startSession(req, res, staff) });
});

authRouter.post("/password/expired", async (req, res) => {
  const parsed = z
    .object({ changeToken: token, newPassword: password })
    .safeParse(req.body);
  if (!parsed.success)
    throw new HttpError(422, "Kata laluan baharu diperlukan");

  // Check the password before spending the token, so a policy mistake can be
  // corrected without signing in again.
  const pendingId = await peekAuthChallengeStaff(
    parsed.data.changeToken,
    "PASSWORD_CHANGE",
  );
  const pending = pendingId ? await getCredentialsById(pendingId) : undefined;
  await checkNewPassword(
    parsed.data.newPassword,
    pending?.password_hash ?? null,
  );

  const staffId = await consumeAuthChallenge(
    parsed.data.changeToken,
    "PASSWORD_CHANGE",
  );
  const staff = staffId ? await getCredentialsById(staffId) : undefined;
  if (!staff || !staff.is_active) {
    throw new HttpError(
      401,
      "Sesi penukaran kata laluan telah tamat. Log masuk semula.",
    );
  }

  await setPassword(staff.id, await hashPassword(parsed.data.newPassword));
  res.json({ data: await startSession(req, res, staff) });
});

// ─── Lupa kata laluan — §8 decision 14 (l) ───────────────────────────────────

const RESET_REQUESTED =
  "Jika e-mel ini milik akaun yang aktif, kod set semula telah dihantar. Kod sah selama 10 minit.";

authRouter.post("/forgot-password", async (req, res) => {
  const parsed = z.object({ email, captchaToken: token }).safeParse(req.body);
  if (!parsed.success)
    throw new HttpError(422, "Masukkan e-mel dan sahkan captcha");
  if (!(await consumeCaptchaPass(parsed.data.captchaToken))) {
    throw new HttpError(400, CAPTCHA_REQUIRED);
  }

  const staff = await getCredentialsByEmail(parsed.data.email);
  const known = Boolean(staff && staff.is_active);
  // A blocked account may reset: that is how its owner unblocks it.
  const challenge = await createAuthChallenge({
    staffId: known ? staff!.id : null,
    purpose: "PASSWORD_RESET",
    ttlMinutes: config.auth.codeTtlMinutes,
    withCode: true,
  });
  if (known && challenge.code) {
    sendCode(
      staff!.email,
      "Kod set semula kata laluan Sistem Aduan Integriti",
      `Permintaan untuk menetapkan semula kata laluan akaun ${staff!.email} telah dibuat.`,
      challenge.code,
    );
  } else if (!config.isProduction) {
    console.log(
      `[Lupa kata laluan] Tiada kod untuk ${parsed.data.email}: bukan akaun yang aktif.`,
    );
  }

  res.json({ data: { resetToken: challenge.token, message: RESET_REQUESTED } });
});

authRouter.post("/reset-password", async (req, res) => {
  const parsed = z
    .object({ resetToken: token, code, newPassword: password })
    .safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(422, "Masukkan kod 6 digit dan kata laluan baharu");
  }
  const policyError = checkPasswordPolicy(parsed.data.newPassword);
  if (policyError) throw new HttpError(422, policyError);

  const invalidReset = new HttpError(
    401,
    "Kod tidak sah, telah digunakan, atau telah tamat tempoh. Minta kod baharu.",
  );
  // Verify the code first (the "differs from current" check must never answer
  // without it), but don't spend it until the new password is acceptable.
  const staffId = await verifyAuthChallengeCode(
    parsed.data.resetToken,
    "PASSWORD_RESET",
    parsed.data.code,
    false,
  );
  const staff = staffId ? await getCredentialsById(staffId) : undefined;
  if (!staff || !staff.is_active) throw invalidReset;
  await checkNewPassword(parsed.data.newPassword, staff.password_hash);
  if (!(await consumeAuthChallenge(parsed.data.resetToken, "PASSWORD_RESET"))) {
    throw invalidReset;
  }

  // Clears the block and the failure count, and signs out every session.
  await setPassword(staff.id, await hashPassword(parsed.data.newPassword));
  await deleteAllSessionsForStaff(staff.id);
  console.log(
    `[Lupa kata laluan] Kata laluan ditetapkan semula: ${staff.email}`,
  );
  res.status(204).end();
});

// ─── Registration — §8 decision 15 ───────────────────────────────────────────

const REGISTRATION_CODE_SENT =
  "Kod pengesahan telah dihantar ke e-mel ini. Masukkan kod untuk melengkapkan pendaftaran. Kod sah selama 10 minit.";

/**
 * Anyone may register; the account is PENGADU until ADMIN gives it a role.
 * The answer is the same whether the address is new, pending or already has
 * an account, so registration can't be used to find out who has one. An
 * existing owner is told by email instead, and gets a token no code satisfies.
 */
authRouter.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(
      parsed.error.issues.some((i) => i.path[0] === "captchaToken") ? 400 : 422,
      parsed.error.issues.some((i) => i.path[0] === "captchaToken")
        ? CAPTCHA_REQUIRED
        : z.prettifyError(parsed.error),
    );
  }
  const { fullName, password: newPassword, captchaToken } = parsed.data;
  const address = parsed.data.email.toLowerCase();

  // Policy first: a weak password is the registrant's own mistake to fix, and
  // saying so reveals nothing about the address.
  const policyError = checkPasswordPolicy(newPassword);
  if (policyError) throw new HttpError(422, policyError);
  if (!(await consumeCaptchaPass(captchaToken))) {
    throw new HttpError(400, CAPTCHA_REQUIRED);
  }

  const result = await registerAccount({
    email: address,
    fullName,
    passwordHash: await hashPassword(newPassword),
  });
  const challenge = await createAuthChallenge({
    staffId: result.state === "pending" ? result.id : null,
    purpose: "REGISTER",
    ttlMinutes: config.auth.codeTtlMinutes,
    withCode: true,
  });

  if (result.state === "pending" && challenge.code) {
    sendCode(
      address,
      "Kod pengesahan pendaftaran Sistem Aduan Integriti",
      `Anda (diharap anda) mendaftar akaun Sistem Aduan Integriti dengan e-mel ${address}.`,
      challenge.code,
    );
  } else {
    void notifyByEmail({
      to: address,
      subject: "Percubaan pendaftaran Sistem Aduan Integriti",
      text: [
        `Seseorang cuba mendaftar akaun baharu dengan e-mel ${address}, tetapi akaun untuk e-mel ini sudah wujud.`,
        "",
        'Jika itu anda, log masuk seperti biasa atau gunakan "Lupa kata laluan".',
        "Jika bukan, abaikan e-mel ini — akaun anda tidak berubah.",
      ].join("\n"),
    }).catch((err: unknown) => {
      console.error("Gagal menghantar notis pendaftaran:", err);
    });
  }

  res.status(202).json({
    data: {
      verifyToken: challenge.token,
      sentTo: maskEmail(address),
      message: REGISTRATION_CODE_SENT,
    },
  });
});

authRouter.post("/register/verify", async (req, res) => {
  const parsed = z.object({ verifyToken: token, code }).safeParse(req.body);
  if (!parsed.success) throw new HttpError(401, INVALID_CODE);

  const staffId = await verifyAuthChallengeCode(
    parsed.data.verifyToken,
    "REGISTER",
    parsed.data.code,
  );
  if (staffId) await markEmailVerified(staffId);
  const account = staffId ? await getCredentialsById(staffId) : undefined;
  if (!account || !account.is_active) throw new HttpError(401, INVALID_CODE);

  console.log(`[Akaun] Pendaftaran disahkan: ${account.email}`);
  res.json({ data: await startSession(req, res, account) });
});

// ─── Session ─────────────────────────────────────────────────────────────────

authRouter.post("/logout", async (req, res) => {
  const sessionToken = readSessionToken(req);
  if (sessionToken) await deleteSession(sessionToken);
  clearSessionCookie(res);
  res.status(204).end();
});

authRouter.get("/me", requireSignedIn(), (req, res) => {
  res.json({ data: describeUser(req.user!) });
});

/**
 * Change own password. Requires the current password even with a valid
 * session, so a hijacked or unattended session can't be used to take over the
 * account. Signs out every OTHER session.
 */
authRouter.post("/password", requireSignedIn(), async (req, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(422, z.prettifyError(parsed.error));
  }

  const staff = req.user!;
  const credentials = await getCredentialsByEmail(staff.email);
  const ok =
    credentials?.password_hash &&
    (await verifyPassword(
      parsed.data.currentPassword,
      credentials.password_hash,
    ));

  if (!ok) throw new HttpError(401, "Kata laluan semasa tidak sah");

  await checkNewPassword(parsed.data.newPassword, credentials.password_hash);

  await setPassword(
    staff.id,
    await hashPassword(parsed.data.newPassword),
    req.sessionToken,
  );

  res.status(204).end();
});
