import { Router } from "express";
import { publicComplaintsRouter } from "./complaints.public.js";
import { adminComplaintsRouter } from "./complaints.admin.js";
import {
  adminCaseActionsRouter,
  adminDecisionsRouter,
} from "./decisions.admin.js";
import { adminMeetingsRouter } from "./meetings.admin.js";
import { adminStatsRouter } from "./stats.admin.js";
import { authRouter } from "./auth.js";
import { complainantRouter } from "./complainant.js";
import { adminProtectionRequestsRouter } from "./protectionRequests.admin.js";
import { referralsRouter } from "./referrals.js";
import { adminSettingsRouter, adminStaffRouter } from "./staff.admin.js";
import { query } from "../db/client.js";

export const apiRouter: Router = Router();

apiRouter.get("/health", async (_req, res) => {
  await query("SELECT 1");
  res.json({ status: "ok", uptime: process.uptime() });
});

/**
 * Two trees, and the split is the security boundary, not a convenience:
 *
 *   /api/complaints  — public portal. Business rule 9 applies: no internal
 *                      notes, no decision records, ever.
 *   /api/admin/*     — Integrity Unit console. Every router here is gated on
 *                      INTEGRITY_UNIT_ROLES, not merely "logged in" — KJ and
 *                      SUB_UNIT staff are authenticated but get 403.
 *
 * Do not mount an admin handler under /api/complaints, however convenient the
 * URL looks.
 */
apiRouter.use("/auth", authRouter);
apiRouter.use("/complaints", publicComplaintsRouter);
// Signed-in complainants (email OTP). Public-safe shapes only, like /complaints.
apiRouter.use("/complainant", complainantRouter);
// KJ / SUB_UNIT only — outside /api/admin on purpose; those roles stay refused there.
apiRouter.use("/referrals", referralsRouter);
apiRouter.use("/admin/complaints", adminComplaintsRouter);
apiRouter.use("/admin/decisions", adminDecisionsRouter);
apiRouter.use("/admin/case-actions", adminCaseActionsRouter);
apiRouter.use("/admin/jmm/meetings", adminMeetingsRouter);
apiRouter.use("/admin/stats", adminStatsRouter);
// KUI only — narrower than the Integrity Unit gate.
apiRouter.use("/admin/protection-requests", adminProtectionRequestsRouter);
// ADMIN only — narrower than the Integrity Unit gate.
apiRouter.use("/admin/staff", adminStaffRouter);
// ADMIN only — security settings (§8 decision 14).
apiRouter.use("/admin/settings", adminSettingsRouter);
