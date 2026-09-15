import { z } from "zod";
import {
  dateRangeFields,
  dateRangeIsOrdered,
  dateRangeMessage,
  dateStringSchema,
  idSchema,
  jmmClassificationSchema,
  jmmOutcomeSchema,
  jmmSignatoryCategorySchema,
  jmmSourceSchema,
  optionalText,
  paginationFields,
} from "./common.js";

const signatorySchema = z.object({
  staffId: idSchema.nullish(),
  roleCategory: jmmSignatoryCategorySchema,
  /** The exact title printed on the form, e.g. 'KPSU (TU) UI (Ahli 1)'. */
  roleTitle: z.string().trim().min(2).max(120),
  signedAt: z.iso.datetime().nullish(),
});

/**
 * Business rule 1 — quorum is checked here at the door as well as in the query
 * layer. A decision cannot even be submitted without a PENGERUSI slot and at
 * least one AHLI slot in its signature block; whether those slots are actually
 * signed is what `getQuorumState` decides later.
 */
export const createDecisionSchema = z
  .object({
    decisionDate: dateStringSchema,
    agencyFileNo: optionalText(120),
    complaintNoOnForm: optionalText(120),
    summary: optionalText(20_000),
    jmmSource: jmmSourceSchema.nullish(),
    jmmClassification: jmmClassificationSchema.nullish(),
    outcome: jmmOutcomeSchema,
    remarksFurtherAction: optionalText(20_000),
    /** §8 decision 2 — the meeting the decision was made at. */
    meetingId: idSchema.nullish(),
    signatories: z.array(signatorySchema).min(1).max(10),
  })
  .refine(
    (value) =>
      value.signatories.some((s) => s.roleCategory === "PENGERUSI") &&
      value.signatories.some((s) => s.roleCategory === "AHLI"),
    {
      path: ["signatories"],
      message:
        "Blok tandatangan mesti mengandungi seorang PENGERUSI dan sekurang-kurangnya seorang AHLI",
    },
  )
  .refine(
    (value) =>
      new Set(value.signatories.map((s) => s.roleTitle)).size ===
      value.signatories.length,
    {
      path: ["signatories"],
      message: "Jawatan penandatangan tidak boleh berulang",
    },
  );

export const signSlotSchema = z.object({
  signatoryId: idSchema,
  signedAt: z.iso.datetime().optional(),
});

export type CreateDecisionBody = z.infer<typeof createDecisionSchema>;

/** `null` unlinks. Refused once the decision is locked (rule 8). */
export const setDecisionMeetingSchema = z.object({
  meetingId: idSchema.nullable(),
});

export const decisionLogFiltersSchema = z
  .object({
    outcome: jmmOutcomeSchema.optional(),
    meetingId: idSchema.optional(),
    ...dateRangeFields,
    ...paginationFields,
  })
  .refine(dateRangeIsOrdered, dateRangeMessage);
