import { Router } from "express";
import { z } from "zod";
import { HttpError } from "../middleware/error-handler.js";
import { requirePermission } from "../middleware/auth.js";
import { idSchema } from "../validation/common.js";
import { updateReferredActionSchema } from "../validation/staff.js";
import {
  listReferredActions,
  updateReferredAction,
} from "../db/queries/caseActions.js";
import { toReferredAction } from "../db/mappers.js";

/**
 * KJ inbox / sub-unit tasks — §8 decision 5. Deliberately NOT under
 * /api/admin: these roles are outside the Integrity Unit and stay refused
 * there. Gated to KJ and SUB_UNIT only; Integrity Unit roles get 403 here too,
 * because this prefix is for the people actions are referred to.
 *
 * Every response is toReferredAction(): five action fields, the complaint's
 * reference number, and the action id. Never internal notes, the case file,
 * the accused party, JMM data, or anything on an NFA complaint.
 */
export const referralsRouter: Router = Router();
referralsRouter.use(requirePermission("referrals.respond"));

referralsRouter.get("/actions", async (req, res) => {
  const rows = await listReferredActions(req.user!.id);
  res.json({ data: rows.map(toReferredAction) });
});

/** `{ responseReceivedDate?, feedbackStatus? }` — nothing else is accepted. */
referralsRouter.patch("/actions/:id", async (req, res) => {
  const id = idSchema.parse(req.params.id);

  const parsed = updateReferredActionSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(422, z.prettifyError(parsed.error));
  }

  // Not yours, on an NFA complaint, or missing: the same 404 for all three.
  const row = await updateReferredAction(req.user!.id, id, parsed.data);
  if (!row) throw new HttpError(404, "Tindakan tidak dijumpai");

  res.json({ data: toReferredAction(row) });
});
