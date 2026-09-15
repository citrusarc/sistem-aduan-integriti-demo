import { z } from "zod";
import {
  complaintDirectedToSchema,
  complaintStatusSchema,
  dateStringSchema,
  emailSchema,
  gradeLevelGroupSchema,
  infoClassificationSchema,
  integrityCategorySchema,
  optionalText,
  phoneSchema,
  sectorSchema,
  sourceChannelSchema,
} from "./common.js";

/** Blank input -> null, like optionalText, before the format check. */
const blankToNull = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? null : value;

/**
 * §8 decision 3 — contact details and anonymity. The same rule the database
 * enforces (chk_anonymous_contact), checked here first so a client gets a 422
 * naming the field instead of a 500.
 */
const complainantFields = z.object({
  particulars: optionalText(2000),
  gradeLevel: gradeLevelGroupSchema.nullish(),
  contactEmail: z.preprocess(blankToNull, emailSchema.nullish()),
  /** For staff to call manually only. Nothing sends to it (rule 10). */
  contactPhone: z.preprocess(blankToNull, phoneSchema.nullish()),
  isAnonymous: z.boolean().default(false),
});

type ComplainantInput = z.infer<typeof complainantFields>;

function checkAnonymous(value: ComplainantInput, ctx: z.RefinementCtx) {
  if (!value.isAnonymous) return;
  if (!value.contactEmail) {
    ctx.addIssue({
      code: "custom",
      path: ["contactEmail"],
      message:
        "Aduan tanpa nama memerlukan alamat e-mel supaya kami boleh menghubungi anda",
    });
  }
  if (value.particulars) {
    ctx.addIssue({
      code: "custom",
      path: ["particulars"],
      message: "Aduan tanpa nama tidak menyimpan nama atau butiran pengadu",
    });
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
  infoClassification: infoClassificationSchema.nullish(),
  integrityCategory: integrityCategorySchema.nullish(),
  sector: sectorSchema.nullish(),
  caseDescription: optionalText(20_000),
  complaintDate: dateStringSchema.nullish(),
  receivedDateUi: dateStringSchema.nullish(),
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
 * PUBLIC portal submission. Stricter than the staff form:
 *   - the complainant block is required, and the handling disclaimer must be
 *     acknowledged (§8 decision 3, rule 6)
 *   - a named submission must actually carry a name; leaving it blank without
 *     choosing "anonymous" would bypass rule 6's contact requirement
 */
export const publicCreateComplaintSchema = z.object({
  ...complaintFields,
  complainant: complainantFields.superRefine((value, ctx) => {
    checkAnonymous(value, ctx);
    if (!value.isAnonymous && !value.particulars) {
      ctx.addIssue({
        code: "custom",
        path: ["particulars"],
        message:
          "Nyatakan nama/butiran anda, atau pilih untuk membuat aduan tanpa nama",
      });
    }
  }),
  disclaimerAcknowledged: z.literal(true, {
    error: "Penafian pengendalian aduan mesti diakui sebelum menghantar",
  }),
  duplicateCheckAcknowledged: z.boolean().default(false),
});

export const updateComplaintSchema = z.object(complaintFields).partial();

export const complaintFiltersSchema = z.object({
  reportYear: z.coerce.number().int().min(2000).max(2100).optional(),
  reportMonth: z.string().trim().min(1).max(32).optional(),
  integrityCategory: integrityCategorySchema.optional(),
  sourceChannel: sourceChannelSchema.optional(),
  sector: sectorSchema.optional(),
  status: complaintStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const duplicateCheckSchema = z.object({
  accusedParticulars: optionalText(2000),
  accusedDepartment: optionalText(500),
  caseDescription: optionalText(20_000),
  withinDays: z.number().int().min(1).max(3650).optional(),
});

export type CreateComplaintBody = z.infer<typeof createComplaintSchema>;
export type UpdateComplaintBody = z.infer<typeof updateComplaintSchema>;
