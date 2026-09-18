import { Router } from "express";
import { z } from "zod";
import { HttpError } from "../middleware/error-handler.js";
import { requirePermission } from "../middleware/auth.js";
import { idSchema } from "../validation/common.js";
import {
  decisionLogFiltersSchema,
  setDecisionMeetingSchema,
  signSlotSchema,
} from "../validation/jmmDecisions.js";
import { updateCaseActionSchema } from "../validation/caseActions.js";
import {
  getDecisionById,
  getQuorumState,
  isDecisionLocked,
  listDecisionLog,
  listSignatories,
  setDecisionMeeting,
  signDecisionSlot,
} from "../db/queries/jmmDecisions.js";
import {
  setCaseActionAssignee,
  updateCaseAction,
} from "../db/queries/caseActions.js";
import { listReferralRecipients } from "../db/queries/staffUsers.js";
import { setAssigneeSchema } from "../validation/staff.js";
import {
  toCaseAction,
  toDecisionLogEntry,
  toJmmDecision,
  toReferralRecipient,
  toSignatory,
} from "../db/mappers.js";

export const adminDecisionsRouter: Router = Router();
adminDecisionsRouter.use(requirePermission("complaints.manage"));

/** Decision log: `outcome`, `from`/`to` (decision date), `meetingId`, `limit`, `offset`. */
adminDecisionsRouter.get("/", async (req, res) => {
  const parsed = decisionLogFiltersSchema.safeParse(req.query);
  if (!parsed.success) {
    throw new HttpError(400, z.prettifyError(parsed.error));
  }

  const rows = await listDecisionLog(parsed.data);
  res.json({ data: rows.map(toDecisionLogEntry) });
});

/**
 * Links a decision to the meeting it was made at (`meetingId: null` unlinks).
 * The complaint must be on that meeting's agenda. 409 once the decision is
 * fully signed — rule 8.
 */
adminDecisionsRouter.put("/:id/meeting", async (req, res) => {
  const id = idSchema.parse(req.params.id);

  const parsed = setDecisionMeetingSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(422, z.prettifyError(parsed.error));
  }

  const decision = await setDecisionMeeting(id, parsed.data.meetingId);
  res.json({ data: toJmmDecision(decision) });
});

adminDecisionsRouter.get("/:id", async (req, res) => {
  const id = idSchema.parse(req.params.id);

  const decision = await getDecisionById(id);
  if (!decision) throw new HttpError(404, "Keputusan JMM tidak dijumpai");

  res.json({
    data: {
      id: decision.id,
      signatories: (await listSignatories(id)).map(toSignatory),
      quorum: await getQuorumState(id),
    },
  });
});

/**
 * Business rule 8 — signing is append-only and terminal.
 *
 * Once quorum is met and every slot is signed the decision is locked, and this
 * refuses further writes. `signDecisionSlot` itself only ever moves a slot from
 * NULL to a timestamp, so a signature can never be withdrawn or backdated over
 * an existing one.
 */
adminDecisionsRouter.post("/:id/sign", async (req, res) => {
  const id = idSchema.parse(req.params.id);

  const decision = await getDecisionById(id);
  if (!decision) throw new HttpError(404, "Keputusan JMM tidak dijumpai");

  if (await isDecisionLocked(id)) {
    throw new HttpError(
      409,
      "Keputusan telah ditandatangani sepenuhnya dan dikunci — rekod keputusan baharu untuk pembetulan",
    );
  }

  const parsed = signSlotSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(422, z.prettifyError(parsed.error));
  }

  const signed = await signDecisionSlot(
    id,
    parsed.data.signatoryId,
    parsed.data.signedAt ?? new Date().toISOString(),
  );

  if (!signed) {
    throw new HttpError(
      409,
      "Slot tandatangan tidak dijumpai bagi keputusan ini atau telah ditandatangani",
    );
  }

  res.json({
    data: {
      signatory: toSignatory(signed),
      quorum: await getQuorumState(id),
    },
  });
});

export const adminCaseActionsRouter: Router = Router();
adminCaseActionsRouter.use(requirePermission("complaints.manage"));

/**
 * Who an action can be referred to: KJ / SUB_UNIT accounts, with `isActive` so
 * the picker offers only active ones but can still name a past assignee. The
 * full staff list stays ADMIN only; this is just the referral targets, without
 * email.
 */
adminCaseActionsRouter.get("/assignees", async (_req, res) => {
  const rows = await listReferralRecipients();
  res.json({ data: rows.map(toReferralRecipient) });
});

adminCaseActionsRouter.patch("/:id", async (req, res) => {
  const id = idSchema.parse(req.params.id);

  const parsed = updateCaseActionSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(422, z.prettifyError(parsed.error));
  }

  const updated = await updateCaseAction(id, parsed.data);
  if (!updated) throw new HttpError(404, "Tindakan kes tidak dijumpai");

  res.json({ data: toCaseAction(updated) });
});

/**
 * §8 decision 5 — refer an action to a KJ / SUB_UNIT account (`staffId: null`
 * clears it). Integrity Unit only, like every route on this router. 409 for an
 * action on an NFA complaint; 422 if the assignee isn't an active KJ/SUB_UNIT.
 */
adminCaseActionsRouter.put("/:id/assignee", async (req, res) => {
  const id = idSchema.parse(req.params.id);

  const parsed = setAssigneeSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(422, z.prettifyError(parsed.error));
  }

  const action = await setCaseActionAssignee(id, parsed.data.staffId);
  res.json({ data: toCaseAction(action) });
});
