import { z } from "zod";
import { MAX_PASSWORD_LENGTH } from "../auth/password.js";
import {
  dateStringSchema,
  idSchema,
  optionalText,
  staffRoleSchema,
} from "./common.js";

/**
 * Password length is capped here only to stop a huge body burning CPU in
 * scrypt; the real policy (checkPasswordPolicy) runs in the route so its
 * message matches the CLI's exactly.
 */
const passwordSchema = z.string().min(1).max(MAX_PASSWORD_LENGTH);

export const createStaffSchema = z.object({
  email: z.string().trim().max(254).pipe(z.email("Alamat e-mel tidak sah")),
  fullName: z.string().trim().min(2).max(200),
  role: staffRoleSchema,
  password: passwordSchema,
});

export const setStaffRoleSchema = z.object({ role: staffRoleSchema });

export const resetStaffPasswordSchema = z.object({ password: passwordSchema });

/** Integrity Unit: `null` clears the referral. */
export const setAssigneeSchema = z.object({ staffId: idSchema.nullable() });

/**
 * KJ / SUB_UNIT update — §8 decision 5: these two fields and nothing else.
 * `strict()` refuses any other key (e.g. `actionTaken`, `uiRemarks`) instead of
 * silently dropping it, so a client learns it isn't allowed.
 */
export const updateReferredActionSchema = z
  .object({
    responseReceivedDate: dateStringSchema.nullish(),
    feedbackStatus: optionalText(2000),
  })
  .strict()
  .refine(
    (value) =>
      value.responseReceivedDate !== undefined ||
      value.feedbackStatus !== undefined,
    { message: "Nyatakan responseReceivedDate atau feedbackStatus" },
  );
