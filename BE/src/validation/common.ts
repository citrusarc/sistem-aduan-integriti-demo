import { z } from "zod";
import {
  CASE_ACTION_TYPE,
  COMPLAINANT_CATEGORY,
  COMPLAINT_DIRECTED_TO,
  COMPLAINT_STATUS,
  GENDER,
  NATIONALITY,
  GRADE_LEVEL_GROUP,
  INFO_CLASSIFICATION,
  INTEGRITY_CATEGORY,
  JMM_CLASSIFICATION,
  JMM_MEETING_STATUS,
  JMM_OUTCOME,
  JMM_SIGNATORY_CATEGORY,
  JMM_SOURCE,
  RECEIVED_VIA,
  SECTOR,
  SOURCE_CHANNEL,
  STAFF_ROLE,
} from "../types/enums.js";

/**
 * One validator per Postgres ENUM, each built from the mirror in
 * `types/enums.ts` rather than by re-typing the values. Adding a value to the
 * mirror without adding it to the database (or vice versa) is still a bug, but
 * at least it can only be made in one place instead of two.
 */

export const gradeLevelGroupSchema = z.enum(GRADE_LEVEL_GROUP);
export const complaintDirectedToSchema = z.enum(COMPLAINT_DIRECTED_TO);
export const sourceChannelSchema = z.enum(SOURCE_CHANNEL);
export const infoClassificationSchema = z.enum(INFO_CLASSIFICATION);
export const integrityCategorySchema = z.enum(INTEGRITY_CATEGORY);
export const sectorSchema = z.enum(SECTOR);
export const caseActionTypeSchema = z.enum(CASE_ACTION_TYPE);
export const jmmSourceSchema = z.enum(JMM_SOURCE);
export const jmmClassificationSchema = z.enum(JMM_CLASSIFICATION);
export const jmmSignatoryCategorySchema = z.enum(JMM_SIGNATORY_CATEGORY);
export const staffRoleSchema = z.enum(STAFF_ROLE);
export const complaintStatusSchema = z.enum(COMPLAINT_STATUS);
export const jmmMeetingStatusSchema = z.enum(JMM_MEETING_STATUS);
export const complainantCategorySchema = z.enum(COMPLAINANT_CATEGORY);
export const genderSchema = z.enum(GENDER);
export const nationalitySchema = z.enum(NATIONALITY);
export const receivedViaSchema = z.enum(RECEIVED_VIA);

/**
 * Business rule 3 — exactly these 6, never a 7th. Because this is derived from
 * JMM_OUTCOME, widening it requires editing the mirror, which sits next to the
 * comment explaining why the 8-value SPRM Tatacara list was superseded.
 */
export const jmmOutcomeSchema = z.enum(JMM_OUTCOME);

/** Calendar date as 'YYYY-MM-DD' — matches how DATE columns are read back. */
export const dateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Tarikh mesti dalam format YYYY-MM-DD");

/** BIGINT ids travel as strings; reject anything that isn't digits. */
export const idSchema = z
  .string()
  .regex(/^\d+$/, "ID mesti nombor bulat positif");

export const complaintRefNoSchema = z
  .string()
  .trim()
  .min(3)
  .max(64)
  .regex(/^[A-Za-z0-9/_-]+$/, "No. rujukan mengandungi aksara tidak sah");

/** Free-text field that should collapse blank input to NULL, not "". */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length ? value : null))
    .nullish();

/** Optional `from`/`to` date-range query params, refusing an inverted range. */
export const dateRangeFields = {
  from: dateStringSchema.optional(),
  to: dateStringSchema.optional(),
};

export const dateRangeIsOrdered = (value: { from?: string; to?: string }) =>
  !value.from || !value.to || value.from <= value.to;

export const dateRangeMessage = {
  path: ["to"],
  message: "Tarikh akhir mesti sama atau selepas tarikh mula",
};

export const paginationFields = {
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
};

/**
 * Email address, normalised to trimmed lower case — the form every lookup,
 * OTP row, and session row uses (migration 007 checks `email = lower(email)`).
 */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email("Alamat e-mel tidak sah"));

/**
 * Phone number, stored for staff to call by hand. Nothing sends to it —
 * business rule 10. Digits with optional +, spaces, and dashes.
 */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9 -]{5,18}[0-9]$/, "Nombor telefon tidak sah");

/** Time of day as 'HH:MM' (seconds allowed) — a TIME column. */
export const timeStringSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "Masa mesti dalam format HH:MM");

/** Malaysian MyKad number, stored as 12 digits (dashes are dropped). */
export const icNoSchema = z
  .string()
  .trim()
  .regex(/^\d{6}-?\d{2}-?\d{4}$/, "No. kad pengenalan mesti 12 digit")
  .transform((value) => value.replace(/-/g, ""));

/** Passport number, stored upper-cased. */
export const passportNoSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9]{5,20}$/, "No. pasport tidak sah")
  .transform((value) => value.toUpperCase());
