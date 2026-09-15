import { Router } from "express";
import { z } from "zod";
import { HttpError } from "../middleware/error-handler.js";
import { requireStaff } from "../middleware/auth.js";
import { INTEGRITY_UNIT_ROLES } from "../auth/roles.js";
import { statsFiltersSchema } from "../validation/stats.js";
import { getComplaintStats } from "../db/queries/stats.js";

/**
 * Dashboard and report counts. Integrity Unit only: the counts include NFA
 * cases (rule 2), so this must never move under a less restricted gate.
 */
export const adminStatsRouter: Router = Router();
adminStatsRouter.use(requireStaff(...INTEGRITY_UNIT_ROLES));

/** `year`, `month` (month requires year). */
adminStatsRouter.get("/", async (req, res) => {
  const parsed = statsFiltersSchema.safeParse(req.query);
  if (!parsed.success) {
    throw new HttpError(400, z.prettifyError(parsed.error));
  }

  res.json({ data: await getComplaintStats(parsed.data) });
});
