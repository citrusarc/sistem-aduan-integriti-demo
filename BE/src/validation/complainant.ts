import { z } from "zod";
import {
  complaintRefNoSchema,
  optionalText,
  paginationFields,
} from "./common.js";
import { PROTECTION_REQUEST_STATUS } from "../types/enums.js";

export const createProtectionRequestSchema = z.object({
  complaintRefNo: complaintRefNoSchema,
  reason: z.string().trim().min(10).max(5000),
});

/** A review decides; it never puts a request back to DITERIMA. */
export const reviewProtectionRequestSchema = z.object({
  status: z.enum(
    PROTECTION_REQUEST_STATUS.filter(
      (s): s is Exclude<typeof s, "DITERIMA"> => s !== "DITERIMA",
    ),
  ),
  reviewNotes: optionalText(5000),
});

export const protectionRequestFiltersSchema = z.object({
  status: z.enum(PROTECTION_REQUEST_STATUS).optional(),
  ...paginationFields,
});
