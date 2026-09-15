import { z } from "zod";
import {
  dateRangeFields,
  dateRangeIsOrdered,
  dateRangeMessage,
  dateStringSchema,
  idSchema,
  jmmMeetingStatusSchema,
  optionalText,
  paginationFields,
} from "./common.js";

const meetingFields = {
  /** e.g. 'JMM Bil. 3/2026'. Unique. */
  meetingNo: z.string().trim().min(1).max(120),
  meetingDate: dateStringSchema,
  venue: optionalText(300),
};

export const createMeetingSchema = z.object(meetingFields);

/**
 * Details only. `status` is deliberately absent: a meeting becomes SELESAI
 * through POST /:id/close, which checks every agenda item has a decision.
 */
export const updateMeetingSchema = z.object(meetingFields).partial();

export const meetingFiltersSchema = z
  .object({
    status: jmmMeetingStatusSchema.optional(),
    ...dateRangeFields,
    ...paginationFields,
  })
  .refine(dateRangeIsOrdered, dateRangeMessage);

export const addAgendaItemSchema = z.object({
  complaintId: idSchema,
  /** 1-based position; omitted, the item goes last. */
  agendaOrder: z.number().int().min(1).optional(),
});

export const reorderAgendaSchema = z.object({
  /** Every complaint currently on the agenda, each once, in the new order. */
  complaintIds: z.array(idSchema).min(1).max(500),
});
