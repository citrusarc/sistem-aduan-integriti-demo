import { Router } from "express";
import { z } from "zod";
import { HttpError } from "../middleware/error-handler.js";
import { requireStaff } from "../middleware/auth.js";
import { INTEGRITY_UNIT_ROLES } from "../auth/roles.js";
import { idSchema } from "../validation/common.js";
import {
  complaintFiltersSchema,
  createComplaintSchema,
  duplicateCheckSchema,
  updateComplaintSchema,
} from "../validation/complaints.js";
import { createCaseActionSchema } from "../validation/caseActions.js";
import { createDecisionSchema } from "../validation/jmmDecisions.js";
import {
  createComplaint,
  closeComplaint,
  findDuplicateCandidates,
  getComplaintById,
  listComplaints,
  updateComplaint,
} from "../db/queries/complaints.js";
import {
  createDecision,
  getQuorumState,
  listDecisionsWithSignatures,
} from "../db/queries/jmmDecisions.js";
import {
  createCaseAction,
  listCaseActions,
} from "../db/queries/caseActions.js";
import { getComplainantById } from "../db/queries/complainants.js";
import {
  toAdminComplaint,
  toCaseAction,
  toComplainant,
  toDecisionWithSignatures,
  toJmmDecision,
  toSignatory,
} from "../db/mappers.js";

/**
 * INTERNAL console API, gated to INTEGRITY_UNIT_ROLES. KJ and SUB_UNIT staff
 * can log in but are refused here: this is the full case register, including
 * NFA cases (rule 2) and internal notes (rule 9).
 *
 * Unlike the public router, these handlers may return the full case file:
 * `ui_remarks`, `psu_action_notes` and decision records are all in scope for
 * the Integrity Unit.
 */
export const adminComplaintsRouter: Router = Router();

adminComplaintsRouter.use(requireStaff(...INTEGRITY_UNIT_ROLES));

adminComplaintsRouter.get("/", async (req, res) => {
  const parsed = complaintFiltersSchema.safeParse(req.query);
  if (!parsed.success) {
    throw new HttpError(400, z.prettifyError(parsed.error));
  }

  const rows = await listComplaints(parsed.data);
  res.json({ data: rows.map(toAdminComplaint) });
});

/**
 * Business rule 5 — staff run this before registering a new case. It is a
 * separate endpoint, not an automatic side effect, so the reviewing officer
 * sees the candidates and makes the call.
 */
adminComplaintsRouter.post("/duplicate-candidates", async (req, res) => {
  const parsed = duplicateCheckSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(422, z.prettifyError(parsed.error));
  }

  const candidates = await findDuplicateCandidates(parsed.data);
  res.json({ data: candidates.map(toAdminComplaint) });
});

adminComplaintsRouter.post("/", async (req, res) => {
  const parsed = createComplaintSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(422, z.prettifyError(parsed.error));
  }

  if (!parsed.data.duplicateCheckAcknowledged) {
    const candidates = await findDuplicateCandidates({
      accusedParticulars: parsed.data.accusedParticulars,
      accusedDepartment: parsed.data.accusedDepartment,
      accused2Particulars: parsed.data.accused2Particulars,
      accused2Department: parsed.data.accused2Department,
      caseDescription: parsed.data.caseDescription,
    });

    if (candidates.length) {
      res.status(409).json({
        error:
          "Semakan pertindihan menemui aduan berkaitan — sahkan sebelum mendaftar",
        data: candidates.map(toAdminComplaint),
      });
      return;
    }
  }

  const complaint = await createComplaint(parsed.data);
  res.status(201).json({ data: toAdminComplaint(complaint) });
});

adminComplaintsRouter.get("/:id", async (req, res) => {
  const id = idSchema.parse(req.params.id);

  const complaint = await getComplaintById(id);
  if (!complaint) throw new HttpError(404, "Aduan tidak dijumpai");

  const [decisions, caseActions, complainant] = await Promise.all([
    listDecisionsWithSignatures(id),
    listCaseActions(id),
    complaint.complainant_id
      ? getComplainantById(complaint.complainant_id)
      : undefined,
  ]);

  res.json({
    data: {
      ...toAdminComplaint(complaint),
      complainant: complainant ? toComplainant(complainant) : null,
      decisions: decisions.map(toDecisionWithSignatures),
      caseActions: caseActions.map(toCaseAction),
    },
  });
});

adminComplaintsRouter.patch("/:id", async (req, res) => {
  const id = idSchema.parse(req.params.id);

  const parsed = updateComplaintSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(422, z.prettifyError(parsed.error));
  }

  // `complaint_ref_no` is not in the update schema at all (business rule 7),
  // so a client sending one is told plainly rather than silently ignored.
  if (
    req.body &&
    typeof req.body === "object" &&
    "complaintRefNo" in req.body
  ) {
    throw new HttpError(
      400,
      "No. rujukan aduan tidak boleh diubah setelah dikeluarkan",
    );
  }

  // Likewise status: it moves only through the transition endpoints (agenda,
  // decisions, close), each of which checks the move is allowed.
  if (req.body && typeof req.body === "object" && "status" in req.body) {
    throw new HttpError(
      400,
      "Status aduan tidak boleh diubah terus — gunakan agenda JMM, keputusan JMM, atau tutup kes",
    );
  }

  const updated = await updateComplaint(id, parsed.data);
  if (!updated) throw new HttpError(404, "Aduan tidak dijumpai");

  res.json({ data: toAdminComplaint(updated) });
});

adminComplaintsRouter.get("/:id/decisions", async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const decisions = await listDecisionsWithSignatures(id);
  res.json({ data: decisions.map(toDecisionWithSignatures) });
});

/**
 * Business rule 8 — a correction to a signed decision is a NEW decision row,
 * never an edit. That is why this is the only write path for decisions and
 * there is no PATCH: re-tabling a case simply posts another decision, exactly
 * as the paper form would be reissued.
 */
adminComplaintsRouter.post("/:id/decisions", async (req, res) => {
  const id = idSchema.parse(req.params.id);

  const parsed = createDecisionSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(422, z.prettifyError(parsed.error));
  }

  const { decision, signatories, status } = await createDecision({
    ...parsed.data,
    complaintId: id,
  });

  res.status(201).json({
    data: {
      ...toJmmDecision(decision),
      signatories: signatories.map(toSignatory),
      quorum: await getQuorumState(decision.id),
      complaintStatus: status,
    },
  });
});

/**
 * §8 decision 1 — staff closes a case: DALAM_TINDAKAN -> SELESAI. The only way
 * a complaint becomes SELESAI. 409 from any other status.
 */
adminComplaintsRouter.post("/:id/close", async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const complaint = await closeComplaint(id);
  res.json({ data: toAdminComplaint(complaint) });
});

adminComplaintsRouter.get("/:id/case-actions", async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const actions = await listCaseActions(id);
  res.json({ data: actions.map(toCaseAction) });
});

adminComplaintsRouter.post("/:id/case-actions", async (req, res) => {
  const id = idSchema.parse(req.params.id);

  const complaint = await getComplaintById(id);
  if (!complaint) throw new HttpError(404, "Aduan tidak dijumpai");

  const parsed = createCaseActionSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(422, z.prettifyError(parsed.error));
  }

  const action = await createCaseAction({ ...parsed.data, complaintId: id });
  res.status(201).json({ data: toCaseAction(action) });
});
