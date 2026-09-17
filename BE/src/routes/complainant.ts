import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { HttpError } from "../middleware/error-handler.js";
import {
  clearComplainantCookie,
  readComplainantToken,
  requireComplainant,
  setComplainantCookie,
} from "../middleware/complainantAuth.js";
import {
  createComplainantSession,
  deleteComplainantSession,
  getComplainantAccountName,
  issueOtp,
  markComplainantAccountVerified,
  registerComplainantAccount,
  verifyOtp,
} from "../auth/complainantStore.js";
import { notifyByEmail } from "../notify/email.js";
import { complaintRefNoSchema } from "../validation/common.js";
import {
  createProtectionRequestSchema,
  registerComplainantSchema,
  requestOtpSchema,
  verifyOtpSchema,
} from "../validation/complainant.js";
import {
  getDisclosableComplaintForEmail,
  listDisclosableComplaintsForEmail,
  listStatusHistory,
} from "../db/queries/complaints.js";
import {
  createProtectionRequest,
  listProtectionRequestsForEmail,
} from "../db/queries/protectionRequests.js";
import {
  toComplainantProtectionRequest,
  toPublicComplaint,
  toStatusTimeline,
} from "../db/mappers.js";

/**
 * Signed-in complainant API — §8 decisions 4 and 6.
 *
 * Everything a complainant sees goes through the PUBLIC shapes
 * (toPublicComplaint, toComplainantProtectionRequest): rule 9 holds exactly as
 * for anonymous tracking. Rule 2 holds too — an NFA case is not "theirs" to
 * see; it answers like a complaint that doesn't exist.
 */
export const complainantRouter: Router = Router();

const policy = {
  digits: config.complainantAuth.otpDigits,
  ttlMinutes: config.complainantAuth.otpTtlMinutes,
  maxAttempts: config.complainantAuth.otpMaxAttempts,
  cooldownSeconds: config.complainantAuth.otpCooldownSeconds,
  maxPerHour: config.complainantAuth.otpMaxPerHour,
};

/**
 * Same answer whether a code was sent, the address has no complaints, or the
 * address is throttled — any difference would reveal who has filed complaints.
 */
const CODE_REQUESTED =
  "Jika alamat e-mel ini berdaftar atau dikaitkan dengan aduan, kod log masuk telah dihantar ke e-mel tersebut. Kod sah selama 10 minit.";

const REGISTRATION_CODE_SENT =
  "Kod pengesahan telah dihantar ke e-mel ini. Masukkan kod untuk melengkapkan pendaftaran. Kod sah selama 10 minit.";

function sendCode(email: string, code: string, kind: "login" | "register") {
  // Not awaited: waiting on the mail transport would make "code sent"
  // measurably slower than "no such address".
  void notifyByEmail({
    to: email,
    subject:
      kind === "register"
        ? "Kod pengesahan pendaftaran Sistem Aduan Integriti"
        : "Kod log masuk Sistem Aduan Integriti",
    text: [
      `${kind === "register" ? "Kod pengesahan" : "Kod log masuk"} anda: ${code}`,
      "",
      `Kod ini sah selama ${policy.ttlMinutes} minit dan hanya boleh digunakan sekali.`,
      "Jika anda tidak meminta kod ini, abaikan e-mel ini.",
    ].join("\n"),
  }).catch((err: unknown) => {
    console.error("Gagal menghantar kod:", err);
  });
}

/** One message for wrong, expired, used, and exhausted codes. */
const INVALID_CODE =
  "Kod tidak sah, telah digunakan, atau telah tamat tempoh. Minta kod baharu jika perlu.";

complainantRouter.post("/auth/request-code", async (req, res) => {
  const parsed = requestOtpSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(422, z.prettifyError(parsed.error));
  }
  const { email } = parsed.data;

  const result = await issueOtp(email, policy, req.ip);
  if (result.issued) {
    sendCode(email, result.code, "login");
  } else if (!config.isProduction) {
    // The response is identical either way (it must not reveal who has filed
    // complaints), so locally say on the server side why no code was printed.
    console.log(
      result.reason === "throttled"
        ? `[OTP] Tiada kod untuk ${email}: had dicapai (${policy.cooldownSeconds} s antara kod, ${policy.maxPerHour} sejam).`
        : `[OTP] Tiada kod untuk ${email}: tiada akaun berdaftar atau aduan yang boleh didedahkan untuk e-mel ini. Daftar dahulu.`,
    );
  }

  res.status(202).json({ data: { message: CODE_REQUESTED } });
});

/**
 * §8 decision 13 — register with name + email. The account becomes usable when
 * the code sent to that address is verified at /auth/verify, which also signs
 * the complainant in.
 */
complainantRouter.post("/auth/register", async (req, res) => {
  const parsed = registerComplainantSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(422, z.prettifyError(parsed.error));
  }
  const { email, fullName } = parsed.data;

  await registerComplainantAccount(email, fullName);
  const result = await issueOtp(email, policy, req.ip, "register");
  if (result.issued) {
    sendCode(email, result.code, "register");
  } else if (!config.isProduction) {
    console.log(
      `[OTP] Tiada kod pendaftaran untuk ${email}: had dicapai (${policy.cooldownSeconds} s antara kod, ${policy.maxPerHour} sejam).`,
    );
  }

  res.status(202).json({ data: { message: REGISTRATION_CODE_SENT } });
});

complainantRouter.post("/auth/verify", async (req, res) => {
  const parsed = verifyOtpSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(401, INVALID_CODE);

  const { email, code } = parsed.data;
  if (!(await verifyOtp(email, code, policy))) {
    throw new HttpError(401, INVALID_CODE);
  }
  await markComplainantAccountVerified(email);

  // Rotate: any earlier complainant cookie is dropped, never promoted.
  const previous = readComplainantToken(req);
  if (previous) await deleteComplainantSession(previous);

  const { token, expiresAt } = await createComplainantSession({
    email,
    ttlMinutes: config.complainantAuth.sessionTtlMinutes,
    ip: req.ip,
    userAgent: req.header("User-Agent"),
  });
  setComplainantCookie(res, token, expiresAt);

  const fullName = await getComplainantAccountName(email);
  res.json({ data: { email, fullName, sessionExpiresAt: expiresAt } });
});

complainantRouter.post("/auth/logout", async (req, res) => {
  const token = readComplainantToken(req);
  if (token) await deleteComplainantSession(token);
  clearComplainantCookie(res);
  res.status(204).end();
});

complainantRouter.get("/auth/me", requireComplainant, async (req, res) => {
  const { email, sessionExpiresAt } = req.complainant!;
  const fullName = await getComplainantAccountName(email);
  res.json({ data: { email, fullName, sessionExpiresAt } });
});

complainantRouter.get("/complaints", requireComplainant, async (req, res) => {
  const rows = await listDisclosableComplaintsForEmail(req.complainant!.email);
  res.json({ data: rows.map(toPublicComplaint) });
});

complainantRouter.get(
  "/complaints/:refNo",
  requireComplainant,
  async (req, res) => {
    const parsed = complaintRefNoSchema.safeParse(req.params.refNo);
    if (!parsed.success) throw new HttpError(400, "No. rujukan tidak sah");

    // Someone else's complaint, an NFA one, and a missing one all answer alike.
    const complaint = await getDisclosableComplaintForEmail(
      req.complainant!.email,
      parsed.data,
    );
    if (!complaint) throw new HttpError(404, "Aduan tidak dijumpai");

    const history = await listStatusHistory(complaint.id);
    res.json({
      data: {
        ...toPublicComplaint(complaint),
        timeline: toStatusTimeline(history),
      },
    });
  },
);

complainantRouter.get(
  "/protection-requests",
  requireComplainant,
  async (req, res) => {
    const rows = await listProtectionRequestsForEmail(req.complainant!.email);
    res.json({ data: rows.map(toComplainantProtectionRequest) });
  },
);

complainantRouter.post(
  "/protection-requests",
  requireComplainant,
  async (req, res) => {
    const parsed = createProtectionRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(422, z.prettifyError(parsed.error));
    }

    const row = await createProtectionRequest({
      email: req.complainant!.email,
      ...parsed.data,
    });
    res.status(201).json({ data: toComplainantProtectionRequest(row) });
  },
);
