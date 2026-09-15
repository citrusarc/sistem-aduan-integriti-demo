import { Router } from "express";
import { z } from "zod";
import { HttpError } from "../middleware/error-handler.js";
import { requireStaff } from "../middleware/auth.js";
import { INTEGRITY_UNIT_ROLES } from "../auth/roles.js";
import { idSchema } from "../validation/common.js";
import {
  addAgendaItemSchema,
  createMeetingSchema,
  meetingFiltersSchema,
  reorderAgendaSchema,
  updateMeetingSchema,
} from "../validation/jmmMeetings.js";
import {
  addAgendaItem,
  closeMeeting,
  createMeeting,
  getMeetingById,
  listAgendaItems,
  listMeetings,
  removeAgendaItem,
  reorderAgenda,
  updateMeeting,
} from "../db/queries/jmmMeetings.js";
import { listDecisionLog } from "../db/queries/jmmDecisions.js";
import {
  toAgendaItem,
  toDecisionLogEntry,
  toMeeting,
  toMeetingListEntry,
} from "../db/mappers.js";

/**
 * JMM meetings and agendas — CLAUDE.md §8 decision 2. Integrity Unit only: an
 * agenda lists complaint reference numbers and statuses, including NFA cases.
 *
 * Status effects (all applied in the query layer, under lock):
 *   POST   /:id/items              complaint -> MENUNGGU_JMM
 *   DELETE /:id/items/:complaintId MENUNGGU_JMM -> BARU / previous outcome
 */
export const adminMeetingsRouter: Router = Router();
adminMeetingsRouter.use(requireStaff(...INTEGRITY_UNIT_ROLES));

/** Full meeting detail: the meeting, its agenda in order, decisions made at it. */
async function meetingDetail(id: string) {
  const meeting = await getMeetingById(id);
  if (!meeting) throw new HttpError(404, "Mesyuarat JMM tidak dijumpai");

  const [items, decisions] = await Promise.all([
    listAgendaItems(id),
    listDecisionLog({ meetingId: id, limit: 200 }),
  ]);

  return {
    ...toMeeting(meeting),
    items: items.map(toAgendaItem),
    decisions: decisions.map(toDecisionLogEntry),
  };
}

adminMeetingsRouter.get("/", async (req, res) => {
  const parsed = meetingFiltersSchema.safeParse(req.query);
  if (!parsed.success) {
    throw new HttpError(400, z.prettifyError(parsed.error));
  }

  const rows = await listMeetings(parsed.data);
  res.json({ data: rows.map(toMeetingListEntry) });
});

adminMeetingsRouter.post("/", async (req, res) => {
  const parsed = createMeetingSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(422, z.prettifyError(parsed.error));
  }

  const meeting = await createMeeting(parsed.data);
  res.status(201).json({ data: await meetingDetail(meeting.id) });
});

adminMeetingsRouter.get("/:id", async (req, res) => {
  const id = idSchema.parse(req.params.id);
  res.json({ data: await meetingDetail(id) });
});

adminMeetingsRouter.patch("/:id", async (req, res) => {
  const id = idSchema.parse(req.params.id);

  if (req.body && typeof req.body === "object" && "status" in req.body) {
    throw new HttpError(
      400,
      "Status mesyuarat tidak boleh diubah terus — gunakan POST /:id/close",
    );
  }

  const parsed = updateMeetingSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(422, z.prettifyError(parsed.error));
  }

  await updateMeeting(id, parsed.data);
  res.json({ data: await meetingDetail(id) });
});

/** DIJADUALKAN -> SELESAI. 409 while any agenda item has no decision. */
adminMeetingsRouter.post("/:id/close", async (req, res) => {
  const id = idSchema.parse(req.params.id);
  await closeMeeting(id);
  res.json({ data: await meetingDetail(id) });
});

adminMeetingsRouter.post("/:id/items", async (req, res) => {
  const id = idSchema.parse(req.params.id);

  const parsed = addAgendaItemSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(422, z.prettifyError(parsed.error));
  }

  await addAgendaItem({ meetingId: id, ...parsed.data });
  res.status(201).json({ data: await meetingDetail(id) });
});

adminMeetingsRouter.delete("/:id/items/:complaintId", async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const complaintId = idSchema.parse(req.params.complaintId);

  await removeAgendaItem({ meetingId: id, complaintId });
  res.json({ data: await meetingDetail(id) });
});

adminMeetingsRouter.put("/:id/items/order", async (req, res) => {
  const id = idSchema.parse(req.params.id);

  const parsed = reorderAgendaSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(422, z.prettifyError(parsed.error));
  }

  await reorderAgenda({
    meetingId: id,
    complaintIds: parsed.data.complaintIds,
  });
  res.json({ data: await meetingDetail(id) });
});
