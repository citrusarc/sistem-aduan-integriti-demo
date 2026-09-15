import { z } from "zod";
import {
  caseActionTypeSchema,
  dateStringSchema,
  idSchema,
  optionalText,
} from "./common.js";

/**
 * Business rule 4 — `actionTaken` is validated against `case_action_type_enum`
 * only. There is deliberately no path by which a `jmm_outcome_enum` value can
 * reach this field: the two vocabularies overlap on 'NFA' and nothing else, and
 * that overlap is a coincidence, not a mapping.
 */
const caseActionFields = {
  jmmDecisionId: idSchema.nullish(),
  psuActionNotes: optionalText(20_000),
  actionTaken: caseActionTypeSchema.nullish(),
  actionDate: dateStringSchema.nullish(),
  responseReceivedDate: dateStringSchema.nullish(),
  feedbackStatus: optionalText(2000),
  uiRemarks: optionalText(20_000),
  fileRefNo: optionalText(120),
  miscNotes: optionalText(20_000),
};

export const createCaseActionSchema = z.object(caseActionFields);
export const updateCaseActionSchema = z.object(caseActionFields).partial();

export type CreateCaseActionBody = z.infer<typeof createCaseActionSchema>;
