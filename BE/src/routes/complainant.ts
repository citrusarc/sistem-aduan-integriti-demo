import { Router, type Request } from "express";
import { z } from "zod";
import { HttpError } from "../middleware/error-handler.js";
import { requirePermission } from "../middleware/auth.js";
import { complaintRefNoSchema } from "../validation/common.js";
import { createProtectionRequestSchema } from "../validation/complainant.js";
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
 * A signed-in account's own complaints — §8 decisions 4, 6 and 15.
 *
 * Signing in is the shared /api/auth flow; "own" means complaints whose
 * complainant contact email is the account's email, which the account proved
 * with an emailed code. Any role may look (permission portal.use): a staff
 * member who filed a complaint sees it exactly as a complainant would.
 *
 * Everything goes through the PUBLIC shapes (toPublicComplaint,
 * toComplainantProtectionRequest): rule 9 holds exactly as for anonymous
 * tracking. Rule 2 holds too — an NFA case is not "theirs" to see; it answers
 * like a complaint that doesn't exist.
 */
export const complainantRouter: Router = Router();
complainantRouter.use(requirePermission("portal.use"));

/** Contact emails are matched lower-cased (emailSchema stores them so). */
const ownEmail = (req: Request) => req.user!.email.toLowerCase();

complainantRouter.get("/complaints", async (req, res) => {
  const rows = await listDisclosableComplaintsForEmail(ownEmail(req));
  res.json({ data: rows.map(toPublicComplaint) });
});

complainantRouter.get("/complaints/:refNo", async (req, res) => {
  const parsed = complaintRefNoSchema.safeParse(req.params.refNo);
  if (!parsed.success) throw new HttpError(400, "No. rujukan tidak sah");

  // Someone else's complaint, an NFA one, and a missing one all answer alike.
  const complaint = await getDisclosableComplaintForEmail(
    ownEmail(req),
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
});

complainantRouter.get("/protection-requests", async (req, res) => {
  const rows = await listProtectionRequestsForEmail(ownEmail(req));
  res.json({ data: rows.map(toComplainantProtectionRequest) });
});

complainantRouter.post("/protection-requests", async (req, res) => {
  const parsed = createProtectionRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(422, z.prettifyError(parsed.error));
  }

  const row = await createProtectionRequest({
    email: ownEmail(req),
    ...parsed.data,
  });
  res.status(201).json({ data: toComplainantProtectionRequest(row) });
});
