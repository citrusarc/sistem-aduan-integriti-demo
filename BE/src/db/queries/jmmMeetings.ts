import type { PoolClient } from "pg";
import { query, queryOne, withTransaction } from "../client.js";
import { DomainError, isUniqueViolation } from "../errors.js";
import { applyStatusEvent, lockComplaint } from "./complaints.js";
import type { JmmMeetingItemRow, JmmMeetingRow } from "../../types/entities.js";
import type {
  ComplaintStatus,
  IntegrityCategory,
  JmmMeetingStatus,
  JmmOutcome,
  Sector,
} from "../../types/enums.js";

/**
 * JMM meetings and their agendas — CLAUDE.md §8 decision 2.
 *
 * Lock order, everywhere in this file: the meeting row first, then the
 * complaint row. Agenda edits on one meeting serialise on the meeting lock;
 * status changes on one complaint serialise on the complaint lock (which
 * createDecision also takes). Keeping one order means no deadlocks.
 */

const MEETING_COLUMNS = `
  id, meeting_no, meeting_date, venue, status, created_at, updated_at
`;

const DUPLICATE_MEETING_NO = "No. mesyuarat ini sudah digunakan";
const MEETING_NOT_FOUND = "Mesyuarat JMM tidak dijumpai";
const MEETING_CLOSED =
  "Mesyuarat ini telah selesai — agenda dan butirannya tidak boleh diubah";

export type MeetingListRow = JmmMeetingRow & {
  item_count: number;
  decided_count: number;
};

export type MeetingFilters = {
  status?: JmmMeetingStatus;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
};

export async function listMeetings(
  filters: MeetingFilters = {},
): Promise<MeetingListRow[]> {
  const result = await query<MeetingListRow>(
    `SELECT m.id, m.meeting_no, m.meeting_date, m.venue, m.status,
            m.created_at, m.updated_at,
            (SELECT count(*)::int FROM jmm_meeting_items i WHERE i.meeting_id = m.id) AS item_count,
            (SELECT count(DISTINCT d.complaint_id)::int
               FROM jmm_decisions d
              WHERE d.meeting_id = m.id) AS decided_count
       FROM jmm_meetings m
      WHERE ($1::jmm_meeting_status_enum IS NULL OR m.status = $1)
        AND ($2::date IS NULL OR m.meeting_date >= $2)
        AND ($3::date IS NULL OR m.meeting_date <= $3)
      ORDER BY m.meeting_date DESC, m.id DESC
      LIMIT $4 OFFSET $5`,
    [
      filters.status ?? null,
      filters.from ?? null,
      filters.to ?? null,
      Math.min(filters.limit ?? 50, 200),
      filters.offset ?? 0,
    ],
  );
  return result.rows;
}

export async function getMeetingById(
  id: string,
): Promise<JmmMeetingRow | undefined> {
  return queryOne<JmmMeetingRow>(
    `SELECT ${MEETING_COLUMNS} FROM jmm_meetings WHERE id = $1`,
    [id],
  );
}

async function lockMeeting(
  client: PoolClient,
  id: string,
  { mustBeOpen }: { mustBeOpen: boolean },
): Promise<JmmMeetingRow> {
  const result = await client.query<JmmMeetingRow>(
    `SELECT ${MEETING_COLUMNS} FROM jmm_meetings WHERE id = $1 FOR UPDATE`,
    [id],
  );
  const meeting = result.rows[0];
  if (!meeting) throw new DomainError(404, MEETING_NOT_FOUND);
  if (mustBeOpen && meeting.status !== "DIJADUALKAN") {
    throw new DomainError(409, MEETING_CLOSED);
  }
  return meeting;
}

export async function createMeeting(input: {
  meetingNo: string;
  meetingDate: string;
  venue?: string | null;
}): Promise<JmmMeetingRow> {
  try {
    const row = await queryOne<JmmMeetingRow>(
      `INSERT INTO jmm_meetings (meeting_no, meeting_date, venue, status)
       VALUES ($1, $2, $3, 'DIJADUALKAN')
       RETURNING ${MEETING_COLUMNS}`,
      [input.meetingNo, input.meetingDate, input.venue ?? null],
    );
    if (!row) throw new Error("Gagal mencipta mesyuarat JMM");
    return row;
  } catch (err) {
    if (isUniqueViolation(err))
      throw new DomainError(409, DUPLICATE_MEETING_NO);
    throw err;
  }
}

const UPDATABLE_COLUMNS = {
  meetingNo: "meeting_no",
  meetingDate: "meeting_date",
  venue: "venue",
} as const;

/** Details only. Status moves through `closeMeeting`, never through here. */
export async function updateMeeting(
  id: string,
  input: Partial<Record<keyof typeof UPDATABLE_COLUMNS, unknown>>,
): Promise<JmmMeetingRow> {
  return withTransaction(async (client) => {
    const meeting = await lockMeeting(client, id, { mustBeOpen: true });

    const assignments: string[] = [];
    const params: unknown[] = [];
    for (const [key, column] of Object.entries(UPDATABLE_COLUMNS)) {
      const value = input[key as keyof typeof UPDATABLE_COLUMNS];
      if (value === undefined) continue;
      params.push(value);
      assignments.push(`${column} = $${params.length}`);
    }
    if (!assignments.length) return meeting;

    params.push(id);
    try {
      const result = await client.query<JmmMeetingRow>(
        `UPDATE jmm_meetings
            SET ${assignments.join(", ")}, updated_at = now()
          WHERE id = $${params.length}
          RETURNING ${MEETING_COLUMNS}`,
        params,
      );
      return result.rows[0] ?? meeting;
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new DomainError(409, DUPLICATE_MEETING_NO);
      }
      throw err;
    }
  });
}

/**
 * Marks a meeting SELESAI. Refused while any agenda item has no decision
 * recorded against this meeting: that complaint would be left MENUNGGU_JMM
 * with no open meeting to wait on. Staff remove deferred items first (which
 * reverts their status) and table them at a later meeting.
 */
export async function closeMeeting(id: string): Promise<JmmMeetingRow> {
  return withTransaction(async (client) => {
    await lockMeeting(client, id, { mustBeOpen: true });

    const undecided = await client.query<{ complaint_ref_no: string }>(
      `SELECT c.complaint_ref_no
         FROM jmm_meeting_items i
         JOIN complaints c ON c.id = i.complaint_id
        WHERE i.meeting_id = $1
          AND NOT EXISTS (
                SELECT 1 FROM jmm_decisions d
                 WHERE d.meeting_id = i.meeting_id
                   AND d.complaint_id = i.complaint_id
              )
        ORDER BY i.agenda_order`,
      [id],
    );
    if (undecided.rows.length) {
      throw new DomainError(
        409,
        `Mesyuarat tidak boleh ditutup: tiada keputusan direkod untuk ${undecided.rows
          .map((r) => r.complaint_ref_no)
          .join(", ")}. Rekod keputusan atau keluarkan dari agenda dahulu.`,
      );
    }

    const result = await client.query<JmmMeetingRow>(
      `UPDATE jmm_meetings
          SET status = 'SELESAI', updated_at = now()
        WHERE id = $1
        RETURNING ${MEETING_COLUMNS}`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw new DomainError(404, MEETING_NOT_FOUND);
    return row;
  });
}

// ─── Agenda ──────────────────────────────────────────────────────────────────

export type AgendaItemRow = JmmMeetingItemRow & {
  complaint_ref_no: string;
  complaint_status: ComplaintStatus;
  integrity_category: IntegrityCategory | null;
  sector: Sector | null;
  received_date_ui: string | null;
  /** Decisions recorded against this meeting for this complaint. */
  decision_count: number;
};

export async function listAgendaItems(
  meetingId: string,
): Promise<AgendaItemRow[]> {
  const result = await query<AgendaItemRow>(
    `SELECT i.id, i.meeting_id, i.complaint_id, i.agenda_order, i.created_at,
            c.complaint_ref_no, c.status AS complaint_status,
            c.integrity_category, c.sector, c.received_date_ui,
            (SELECT count(*)::int FROM jmm_decisions d
              WHERE d.meeting_id = i.meeting_id
                AND d.complaint_id = i.complaint_id) AS decision_count
       FROM jmm_meeting_items i
       JOIN complaints c ON c.id = i.complaint_id
      WHERE i.meeting_id = $1
      ORDER BY i.agenda_order, i.id`,
    [meetingId],
  );
  return result.rows;
}

/** The open meeting a complaint is queued on, if any — at most one (§8 decision 2). */
export async function findOpenMeetingForComplaint(
  client: PoolClient,
  complaintId: string,
): Promise<{ id: string; meeting_no: string } | undefined> {
  const result = await client.query<{ id: string; meeting_no: string }>(
    `SELECT m.id, m.meeting_no
       FROM jmm_meeting_items i
       JOIN jmm_meetings m ON m.id = i.meeting_id
      WHERE i.complaint_id = $1
        AND m.status = 'DIJADUALKAN'
      LIMIT 1`,
    [complaintId],
  );
  return result.rows[0];
}

/** Renumbers agenda_order as 1..n, keeping the current order. */
async function compactAgenda(client: PoolClient, meetingId: string) {
  await client.query(
    `UPDATE jmm_meeting_items i
        SET agenda_order = ranked.n
       FROM (SELECT id, row_number() OVER (ORDER BY agenda_order, id) AS n
               FROM jmm_meeting_items
              WHERE meeting_id = $1) ranked
      WHERE i.id = ranked.id
        AND i.agenda_order <> ranked.n`,
    [meetingId],
  );
}

/**
 * Tables a complaint at an open meeting: AGENDA_ADDED -> MENUNGGU_JMM.
 * `agendaOrder` inserts at that position (shifting later items down);
 * omitted, the item goes last.
 */
export async function addAgendaItem(input: {
  meetingId: string;
  complaintId: string;
  agendaOrder?: number;
}): Promise<void> {
  await withTransaction(async (client) => {
    await lockMeeting(client, input.meetingId, { mustBeOpen: true });
    const complaint = await lockComplaint(client, input.complaintId);

    const open = await findOpenMeetingForComplaint(client, complaint.id);
    if (open) {
      throw new DomainError(
        409,
        open.id === input.meetingId
          ? "Aduan ini sudah berada dalam agenda mesyuarat ini"
          : `Aduan ini sudah berada dalam agenda mesyuarat ${open.meeting_no} yang belum selesai`,
      );
    }

    await applyStatusEvent(client, complaint, { type: "AGENDA_ADDED" });

    const countResult = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM jmm_meeting_items WHERE meeting_id = $1`,
      [input.meetingId],
    );
    const count = countResult.rows[0]?.n ?? 0;
    const position = Math.min(
      Math.max(input.agendaOrder ?? count + 1, 1),
      count + 1,
    );

    await compactAgenda(client, input.meetingId);
    await client.query(
      `UPDATE jmm_meeting_items
          SET agenda_order = agenda_order + 1
        WHERE meeting_id = $1 AND agenda_order >= $2`,
      [input.meetingId, position],
    );

    try {
      await client.query(
        `INSERT INTO jmm_meeting_items (meeting_id, complaint_id, agenda_order)
         VALUES ($1, $2, $3)`,
        [input.meetingId, complaint.id, position],
      );
    } catch (err) {
      // The migration 004 trigger, if a concurrent request slipped past the
      // check above.
      if (isUniqueViolation(err)) {
        throw new DomainError(
          409,
          "Aduan ini sudah berada dalam agenda mesyuarat yang belum selesai",
        );
      }
      throw err;
    }
  });
}

/**
 * Takes a complaint off an open meeting's agenda. Refused once a decision has
 * been recorded against this meeting for it — the item is then part of the
 * meeting's record.
 *
 * A MENUNGGU_JMM complaint reverts (AGENDA_REMOVED) to what the last recorded
 * decision made it — NFA or DALAM_TINDAKAN — or BARU if it has none. Any other
 * status is left alone: it already reflects a decision, not the queue.
 */
export async function removeAgendaItem(input: {
  meetingId: string;
  complaintId: string;
}): Promise<void> {
  await withTransaction(async (client) => {
    await lockMeeting(client, input.meetingId, { mustBeOpen: true });
    const complaint = await lockComplaint(client, input.complaintId);

    const item = await client.query(
      `SELECT 1 FROM jmm_meeting_items WHERE meeting_id = $1 AND complaint_id = $2`,
      [input.meetingId, complaint.id],
    );
    if (!item.rowCount) {
      throw new DomainError(404, "Aduan ini tiada dalam agenda mesyuarat ini");
    }

    const decided = await client.query(
      `SELECT 1 FROM jmm_decisions WHERE meeting_id = $1 AND complaint_id = $2`,
      [input.meetingId, complaint.id],
    );
    if (decided.rowCount) {
      throw new DomainError(
        409,
        "Keputusan telah direkod untuk aduan ini dalam mesyuarat ini — ia tidak boleh dikeluarkan dari agenda",
      );
    }

    await client.query(
      `DELETE FROM jmm_meeting_items WHERE meeting_id = $1 AND complaint_id = $2`,
      [input.meetingId, complaint.id],
    );
    await compactAgenda(client, input.meetingId);

    if (complaint.status === "MENUNGGU_JMM") {
      // Most recently recorded, not latest decision_date: this is the decision
      // whose transition set the status before the case was re-tabled.
      const last = await client.query<{ outcome: JmmOutcome }>(
        `SELECT outcome FROM jmm_decisions
          WHERE complaint_id = $1
          ORDER BY id DESC
          LIMIT 1`,
        [complaint.id],
      );
      await applyStatusEvent(client, complaint, {
        type: "AGENDA_REMOVED",
        lastOutcome: last.rows[0]?.outcome ?? null,
      });
    }
  });
}

/**
 * Sets the agenda to exactly this order. `complaintIds` must be the meeting's
 * current items, each once — anything else is refused rather than guessed at.
 */
export async function reorderAgenda(input: {
  meetingId: string;
  complaintIds: readonly string[];
}): Promise<void> {
  await withTransaction(async (client) => {
    await lockMeeting(client, input.meetingId, { mustBeOpen: true });

    const current = await client.query<{ complaint_id: string }>(
      `SELECT complaint_id FROM jmm_meeting_items WHERE meeting_id = $1`,
      [input.meetingId],
    );
    const currentIds = new Set(current.rows.map((r) => r.complaint_id));
    const given = new Set(input.complaintIds);

    const sameSet =
      given.size === input.complaintIds.length &&
      given.size === currentIds.size &&
      [...given].every((id) => currentIds.has(id));
    if (!sameSet) {
      throw new DomainError(
        422,
        "Susunan agenda mesti menyenaraikan setiap aduan dalam agenda tepat sekali",
      );
    }

    await client.query(
      `UPDATE jmm_meeting_items i
          SET agenda_order = o.n
         FROM unnest($2::bigint[]) WITH ORDINALITY AS o(complaint_id, n)
        WHERE i.meeting_id = $1
          AND i.complaint_id = o.complaint_id`,
      [input.meetingId, input.complaintIds],
    );
  });
}

/**
 * For recording or linking a decision: the meeting must exist and have the
 * complaint on its agenda. Meeting status doesn't matter — forms are often
 * signed after the sitting is closed.
 */
export async function assertComplaintOnMeetingAgenda(
  client: PoolClient,
  meetingId: string,
  complaintId: string,
): Promise<void> {
  const result = await client.query<{ on_agenda: boolean }>(
    `SELECT EXISTS (
              SELECT 1 FROM jmm_meeting_items
               WHERE meeting_id = m.id AND complaint_id = $2
            ) AS on_agenda
       FROM jmm_meetings m
      WHERE m.id = $1`,
    [meetingId, complaintId],
  );
  const row = result.rows[0];
  if (!row) throw new DomainError(422, MEETING_NOT_FOUND);
  if (!row.on_agenda) {
    throw new DomainError(
      422,
      "Aduan ini tiada dalam agenda mesyuarat tersebut — masukkan ke agenda dahulu",
    );
  }
}
