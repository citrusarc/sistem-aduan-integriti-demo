import { z } from "zod";
import {
  complainantCategorySchema,
  complaintDirectedToSchema,
  complaintStatusSchema,
  dateRangeFields,
  dateRangeIsOrdered,
  dateRangeMessage,
  dateStringSchema,
  emailSchema,
  genderSchema,
  gradeLevelGroupSchema,
  icNoSchema,
  infoClassificationSchema,
  integrityCategorySchema,
  nationalitySchema,
  optionalText,
  passportNoSchema,
  phoneSchema,
  receivedViaSchema,
  sectorSchema,
  sourceChannelSchema,
  timeStringSchema,
} from "./common.js";

/** Blank input -> null, like optionalText, before the format check. */
const blankToNull = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? null : value;

/**
 * §8 decisions 3 and 10 — contact details and anonymity. The same rules the
 * database enforces (chk_anonymous_no_name, chk_anonymous_identity), checked
 * here first so a client gets a 422 naming the field instead of a 500.
 */
const complainantFields = z.object({
  /** NAMA on Lampiran 2. */
  particulars: optionalText(2000),
  gradeLevel: gradeLevelGroupSchema.nullish(),
  contactEmail: z.preprocess(blankToNull, emailSchema.nullish()),
  /** For staff to call manually only. Nothing sends to it (rule 10). */
  contactPhone: z.preprocess(blankToNull, phoneSchema.nullish()),
  isAnonymous: z.boolean().default(false),

  // BORANG ADUAN/ MAKLUMAT (Lampiran 2), migration 010. All optional.
  complainantCategory: complainantCategorySchema.nullish(),
  icNo: z.preprocess(blankToNull, icNoSchema.nullish()),
  passportNo: z.preprocess(blankToNull, passportNoSchema.nullish()),
  age: z.number().int().min(0).max(130).nullish(),
  gender: genderSchema.nullish(),
  race: optionalText(100),
  nationality: nationalitySchema.nullish(),
  /** Same as contactPhone: staff call it by hand, nothing sends to it. */
  contactPhone2: z.preprocess(blankToNull, phoneSchema.nullish()),
  postalAddress: optionalText(1000),
  occupation: optionalText(200),
  employer: optionalText(500),
});

type ComplainantInput = z.infer<typeof complainantFields>;

/**
 * Every complainant field. An anonymous complainant gives none of them
 * (§8 decision 11) — refused rather than dropped, so nothing typed can be
 * stored by mistake. Backed by chk_anonymous_identity (010) and
 * chk_anonymous_no_details (012).
 */
const COMPLAINANT_DETAIL_FIELDS = [
  "particulars",
  "gradeLevel",
  "complainantCategory",
  "contactEmail",
  "contactPhone",
  "contactPhone2",
  "icNo",
  "passportNo",
  "age",
  "gender",
  "race",
  "nationality",
  "postalAddress",
  "occupation",
  "employer",
] as const satisfies readonly (keyof ComplainantInput)[];

function checkAnonymous(value: ComplainantInput, ctx: z.RefinementCtx) {
  if (!value.isAnonymous) return;
  for (const field of COMPLAINANT_DETAIL_FIELDS) {
    if (value[field] !== null && value[field] !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: [field],
        message: "Aduan tanpa nama tidak menyimpan sebarang butiran pengadu",
      });
    }
  }
}

const complainantSchema = complainantFields.superRefine(checkAnonymous);

const complaintFields = {
  reportMonth: optionalText(32),
  reportYear: z.number().int().min(2000).max(2100).nullish(),
  directedTo: complaintDirectedToSchema.nullish(),
  sourceChannel: sourceChannelSchema.nullish(),
  accusedParticulars: optionalText(2000),
  accusedGradeLevel: gradeLevelGroupSchema.nullish(),
  accusedDepartment: optionalText(500),
  // Lampiran 2 (migration 010): JAWATAN (1), and NAMA ORANG YANG DITOHMAH (2).
  accusedPosition: optionalText(200),
  accused2Particulars: optionalText(2000),
  accused2Department: optionalText(500),
  accused2Position: optionalText(200),
  infoClassification: infoClassificationSchema.nullish(),
  integrityCategory: integrityCategorySchema.nullish(),
  sector: sectorSchema.nullish(),
  caseDescription: optionalText(20_000),
  complaintDate: dateStringSchema.nullish(),
  receivedDateUi: dateStringSchema.nullish(),
  incidentDate: dateStringSchema.nullish(),
  incidentTime: z.preprocess(blankToNull, timeStringSchema.nullish()),
  hasSupportingDocuments: z.boolean().nullish(),
  /** Lampiran 2's receiver section — its own list, not `sourceChannel`. */
  receivedVia: receivedViaSchema.nullish(),
};

/**
 * Note there is no `complaintRefNo` here. Business rule 7 makes the reference
 * number server-issued and immutable, so it is neither accepted on create nor
 * on update — the route allocates it inside the insert transaction.
 */
export const createComplaintSchema = z.object({
  ...complaintFields,
  complainant: complainantSchema.nullish(),
  /**
   * Business rule 5: the duplicate check runs before every registration. Staff
   * who have reviewed the candidates and judged the case genuinely new pass
   * this to proceed. It cannot default to true.
   */
  duplicateCheckAcknowledged: z.boolean().default(false),
});

/**
 * PUBLIC portal submission, following BORANG ADUAN/ MAKLUMAT (Lampiran 2).
 * Stricter than the staff form:
 *   - only the complainant's part of the form: the description, who is
 *     accused and where, the category, when it happened, and whether there
 *     are supporting documents. The unit's own fields (complaint and received
 *     dates, report month/year, both channel lists, classification, sector)
 *     are set by the server or by staff, never by the public; unknown keys
 *     are dropped
 *   - the complainant block is required, and the handling disclaimer must be
 *     acknowledged (§8 decision 3, rule 6)
 *   - a named submission must actually carry a name; a blank one is refused
 *     rather than quietly treated as anonymous
 *   - a named submission states nationality, and gives an IC number if
 *     Malaysian or a passport number if not (§8 decision 12)
 *   - supporting documents arrive as multipart files alongside this body
 *     (§8 decisions 10–11); the route sets hasSupportingDocuments from them
 */
export const publicCreateComplaintSchema = z.object({
  caseDescription: complaintFields.caseDescription,
  accusedParticulars: complaintFields.accusedParticulars,
  accusedDepartment: complaintFields.accusedDepartment,
  accusedPosition: complaintFields.accusedPosition,
  accused2Particulars: complaintFields.accused2Particulars,
  accused2Department: complaintFields.accused2Department,
  accused2Position: complaintFields.accused2Position,
  integrityCategory: complaintFields.integrityCategory,
  incidentDate: complaintFields.incidentDate,
  incidentTime: complaintFields.incidentTime,
  // No hasSupportingDocuments: the portal has no ADA/TIADA question; the
  // route records it from whether files were attached (§8 decision 11).
  complainant: complainantFields.superRefine((value, ctx) => {
    checkAnonymous(value, ctx);
    if (value.isAnonymous) return;
    if (!value.particulars) {
      ctx.addIssue({
        code: "custom",
        path: ["particulars"],
        message:
          "Nyatakan nama/butiran anda, atau pilih untuk membuat aduan tanpa nama",
      });
    }
    // §8 decision 12: a named complainant proves identity by the document
    // their nationality implies — MyKad for a citizen, passport otherwise.
    // The other document stays optional, never refused.
    if (!value.nationality) {
      ctx.addIssue({
        code: "custom",
        path: ["nationality"],
        message: "Nyatakan warganegara anda",
      });
    } else if (value.nationality === "WARGANEGARA") {
      if (!value.icNo) {
        ctx.addIssue({
          code: "custom",
          path: ["icNo"],
          message: "No. kad pengenalan wajib bagi warganegara Malaysia",
        });
      }
    } else if (!value.passportNo) {
      ctx.addIssue({
        code: "custom",
        path: ["passportNo"],
        message: "No. pasport wajib bagi bukan warganegara",
      });
    }
  }),
  disclaimerAcknowledged: z.literal(true, {
    error: "Penafian pengendalian aduan mesti diakui sebelum menghantar",
  }),
  duplicateCheckAcknowledged: z.boolean().default(false),
});

export const updateComplaintSchema = z.object(complaintFields).partial();

export const complaintFiltersSchema = z
  .object({
    reportYear: z.coerce.number().int().min(2000).max(2100).optional(),
    reportMonth: z.string().trim().min(1).max(32).optional(),
    integrityCategory: integrityCategorySchema.optional(),
    sourceChannel: sourceChannelSchema.optional(),
    sector: sectorSchema.optional(),
    status: complaintStatusSchema.optional(),
    /** Period, on the same date stats uses (PERIOD_DATE_SQL). */
    ...dateRangeFields,
    limit: z.coerce.number().int().min(1).max(200).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })
  .refine(dateRangeIsOrdered, dateRangeMessage);

export const duplicateCheckSchema = z.object({
  accusedParticulars: optionalText(2000),
  accusedDepartment: optionalText(500),
  accused2Particulars: optionalText(2000),
  accused2Department: optionalText(500),
  caseDescription: optionalText(20_000),
  withinDays: z.number().int().min(1).max(3650).optional(),
});

export type CreateComplaintBody = z.infer<typeof createComplaintSchema>;
export type UpdateComplaintBody = z.infer<typeof updateComplaintSchema>;
