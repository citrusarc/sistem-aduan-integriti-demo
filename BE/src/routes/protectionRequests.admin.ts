import { Router } from "express";
import { z } from "zod";
import { HttpError } from "../middleware/error-handler.js";
import { requirePermission } from "../middleware/auth.js";
import { idSchema } from "../validation/common.js";
import {
  protectionRequestFiltersSchema,
  reviewProtectionRequestSchema,
} from "../validation/complainant.js";
import {
  getProtectionRequest,
  listProtectionRequests,
  reviewProtectionRequest,
} from "../db/queries/protectionRequests.js";
import { toAdminProtectionRequest } from "../db/mappers.js";

/**
 * Protection requests — §8 decision 6: KUI ONLY, for listing as well as review.
 * Narrower than INTEGRITY_UNIT_ROLES on purpose; other Integrity Unit roles,
 * ADMIN included, get 403.
 */
export const adminProtectionRequestsRouter: Router = Router();
adminProtectionRequestsRouter.use(requirePermission("protection.review"));

adminProtectionRequestsRouter.get("/", async (req, res) => {
  const parsed = protectionRequestFiltersSchema.safeParse(req.query);
  if (!parsed.success) {
    throw new HttpError(400, z.prettifyError(parsed.error));
  }
  const rows = await listProtectionRequests(parsed.data);
  res.json({ data: rows.map(toAdminProtectionRequest) });
});

adminProtectionRequestsRouter.get("/:id", async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const row = await getProtectionRequest(id);
  if (!row) throw new HttpError(404, "Permohonan perlindungan tidak dijumpai");
  res.json({ data: toAdminProtectionRequest(row) });
});

/** `{ status: DILULUSKAN | DITOLAK, reviewNotes? }`. 409 once already reviewed. */
adminProtectionRequestsRouter.post("/:id/review", async (req, res) => {
  const id = idSchema.parse(req.params.id);

  const parsed = reviewProtectionRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(422, z.prettifyError(parsed.error));
  }

  await reviewProtectionRequest({
    id,
    status: parsed.data.status,
    reviewNotes: parsed.data.reviewNotes ?? null,
    reviewerId: req.user!.id,
  });

  const row = await getProtectionRequest(id);
  res.json({ data: row && toAdminProtectionRequest(row) });
});
