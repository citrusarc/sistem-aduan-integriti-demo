import type { PoolClient } from "pg";
import { pool, query, queryOne, withTransaction } from "../client.js";
import { DomainError } from "../errors.js";
import { applyStatusEvent, lockComplaint } from "./complaints.js";
import {
  assertComplaintOnMeetingAgenda,
  findOpenMeetingForComplaint,
} from "./jmmMeetings.js";
import type {
  JmmDecisionRow,
  JmmDecisionSignatoryRow,
} from "../../types/entities.js";
import type {
  ComplaintStatus,
  JmmClassification,
  JmmOutcome,
  JmmSignatoryCategory,
  JmmSource,
} from "../../types/enums.js";

const DECISION_COLUMNS = `
  id, complaint_id, decision_date, agency_file_no, complaint_no_on_form,
  summary, jmm_source, jmm_classification, outcome, remarks_further_action,
  meeting_id, created_at
`;

const SIGNATORY_COLUMNS = `
  id, jmm_decision_id, staff_id, role_category, role_title, signed_at
`;

export async function listDecisionsForComplaint(
  complaintId: string,
): Promise<JmmDecisionRow[]> {
  const result = await query<JmmDecisionRow>(
    `SELECT ${DECISION_COLUMNS}
       FROM jmm_decisions
      WHERE complaint_id = $1
      ORDER BY decision_date DESC, id DESC`,
    [complaintId],
  );
  return result.rows;
}

export async function getDecisionById(
  id: string,
): Promise<JmmDecisionRow | undefined> {
  return queryOne<JmmDecisionRow>(
    `SELECT ${DECISION_COLUMNS} FROM jmm_decisions WHERE id = $1`,
    [id],
  );
}

export async function listSignatories(
  decisionId: string,
): Promise<JmmDecisionSignatoryRow[]> {
  const result = await query<JmmDecisionSignatoryRow>(
    `SELECT ${SIGNATORY_COLUMNS}
       FROM jmm_decision_signatories
      WHERE jmm_decision_id = $1
      ORDER BY role_category, role_title`,
    [decisionId],
  );
  return result.rows;
}

export type CreateDecisionInput = {
  complaintId: string;
  decisionDate: string;
  agencyFileNo?: string | null;
  complaintNoOnForm?: string | null;
  summary?: string | null;
  jmmSource?: JmmSource | null;
  jmmClassification?: JmmClassification | null;
  outcome: JmmOutcome;
  remarksFurtherAction?: string | null;
  /** The meeting the decision was made at. Required while the complaint is on an open agenda. */
  meetingId?: string | null;
  signatories: ReadonlyArray<{
    staffId?: string | null;
    roleCategory: JmmSignatoryCategory;
    roleTitle: string;
    signedAt?: string | null;
  }>;
};

/**
 * Records a decision and its signature block together. A decision with no
 * signature block is meaningless on the real form, so both land in one
 * transaction or neither does — together with the status transition
 * (DECISION_RECORDED: -> NFA, or -> DALAM_TINDAKAN for any other outcome).
 *
 * While the complaint sits on an open meeting's agenda, the decision must be
 * recorded against that meeting: otherwise the case would be decided while
 * still queued, and the meeting could never account for it.
 */
export async function createDecision(input: CreateDecisionInput): Promise<{
  decision: JmmDecisionRow;
  signatories: JmmDecisionSignatoryRow[];
  status: ComplaintStatus;
}> {
  return withTransaction(async (client) => {
    const complaint = await lockComplaint(client, input.complaintId);

    const openMeeting = await findOpenMeetingForComplaint(client, complaint.id);
    if (openMeeting && input.meetingId !== openMeeting.id) {
      throw new DomainError(
        409,
        `Aduan ini berada dalam agenda mesyuarat ${openMeeting.meeting_no} — rekod keputusan untuk mesyuarat tersebut`,
      );
    }
    if (input.meetingId) {
      await assertComplaintOnMeetingAgenda(
        client,
        input.meetingId,
        complaint.id,
      );
    }

    const status = await applyStatusEvent(client, complaint, {
      type: "DECISION_RECORDED",
      outcome: input.outcome,
    });

    const inserted = await client.query<JmmDecisionRow>(
      `INSERT INTO jmm_decisions (
         complaint_id, decision_date, agency_file_no, complaint_no_on_form,
         summary, jmm_source, jmm_classification, outcome,
         remarks_further_action, meeting_id
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING ${DECISION_COLUMNS}`,
      [
        input.complaintId,
        input.decisionDate,
        input.agencyFileNo ?? null,
        input.complaintNoOnForm ?? null,
        input.summary ?? null,
        input.jmmSource ?? null,
        input.jmmClassification ?? null,
        input.outcome,
        input.remarksFurtherAction ?? null,
        input.meetingId ?? null,
      ],
    );

    const decision = inserted.rows[0];
    if (!decision) throw new Error("Gagal merekod keputusan JMM");

    // §8 decision 15: the account table holds complainants too (PENGADU).
    // A signatory linked to an account must be a staff member.
    const linked = input.signatories
      .map((s) => s.staffId)
      .filter((id): id is string => Boolean(id));
    if (linked.length) {
      const pengadu = await client.query(
        `SELECT 1 FROM staff_users
          WHERE id = ANY($1::bigint[]) AND role = 'PENGADU'`,
        [linked],
      );
      if (pengadu.rowCount) {
        throw new DomainError(
          422,
          "Penandatangan mesti akaun kakitangan, bukan akaun pengadu",
        );
      }
    }

    const signatories: JmmDecisionSignatoryRow[] = [];
    for (const signatory of input.signatories) {
      const row = await client.query<JmmDecisionSignatoryRow>(
        `INSERT INTO jmm_decision_signatories (
           jmm_decision_id, staff_id, role_category, role_title, signed_at
         )
         VALUES ($1,$2,$3,$4,$5)
         RETURNING ${SIGNATORY_COLUMNS}`,
        [
          decision.id,
          signatory.staffId ?? null,
          signatory.roleCategory,
          signatory.roleTitle,
          signatory.signedAt ?? null,
        ],
      );
      const created = row.rows[0];
      if (created) signatories.push(created);
    }

    return { decision, signatories, status };
  });
}

/**
 * Business rule 1 — JMM quorum.
 *
 * A decision counts as finalized only with a PENGERUSI signatory and at least
 * one AHLI signatory, each actually signed (`signed_at` populated). Mirrors the
 * real committee composition rule on the form.
 */
export type QuorumState = {
  hasChair: boolean;
  memberCount: number;
  /** Every recorded signatory has signed. */
  fullySigned: boolean;
  /** Quorum met AND fully signed — the only state that counts as finalized. */
  finalized: boolean;
};

/**
 * Quorum for several decisions in one query — the single SQL definition of
 * rule 1; getQuorumState is this for one id. A decision with no signatories
 * gets an all-false state.
 */
export async function getQuorumStates(
  decisionIds: string[],
  /** Pass the transaction's client when called inside one. */
  client?: PoolClient,
): Promise<Map<string, QuorumState>> {
  const states = new Map<string, QuorumState>();
  if (!decisionIds.length) return states;

  const result = await (client ?? pool).query<{
    decision_id: string;
    signed_chairs: string;
    signed_members: string;
    unsigned: string;
    total: string;
  }>(
    `SELECT
       jmm_decision_id                                                               AS decision_id,
       count(*) FILTER (WHERE role_category = 'PENGERUSI' AND signed_at IS NOT NULL) AS signed_chairs,
       count(*) FILTER (WHERE role_category = 'AHLI'      AND signed_at IS NOT NULL) AS signed_members,
       count(*) FILTER (WHERE signed_at IS NULL)                                     AS unsigned,
       count(*)                                                                      AS total
     FROM jmm_decision_signatories
     WHERE jmm_decision_id = ANY($1::bigint[])
     GROUP BY jmm_decision_id`,
    [decisionIds],
  );
  const rows = new Map(result.rows.map((r) => [r.decision_id, r]));

  for (const id of decisionIds) {
    const row = rows.get(id);
    const hasChair = Number(row?.signed_chairs ?? 0) > 0;
    const memberCount = Number(row?.signed_members ?? 0);
    const total = Number(row?.total ?? 0);
    const fullySigned = total > 0 && Number(row?.unsigned ?? 0) === 0;
    states.set(id, {
      hasChair,
      memberCount,
      fullySigned,
      finalized: hasChair && memberCount >= 1 && fullySigned,
    });
  }
  return states;
}

export async function getQuorumState(
  decisionId: string,
  /** Pass the transaction's client when called inside one. */
  client?: PoolClient,
): Promise<QuorumState> {
  return (await getQuorumStates([decisionId], client)).get(decisionId)!;
}

/**
 * A complaint's decisions with their signature blocks and quorum, in three
 * queries whatever the number of decisions.
 */
export async function listDecisionsWithSignatures(complaintId: string): Promise<
  {
    decision: JmmDecisionRow;
    signatories: JmmDecisionSignatoryRow[];
    quorum: QuorumState;
  }[]
> {
  const decisions = await listDecisionsForComplaint(complaintId);
  const ids = decisions.map((d) => d.id);
  if (!ids.length) return [];

  const [signatories, quorum] = await Promise.all([
    query<JmmDecisionSignatoryRow>(
      `SELECT ${SIGNATORY_COLUMNS}
         FROM jmm_decision_signatories
        WHERE jmm_decision_id = ANY($1::bigint[])
        ORDER BY role_category, role_title`,
      [ids],
    ),
    getQuorumStates(ids),
  ]);

  const byDecision = new Map<string, JmmDecisionSignatoryRow[]>();
  for (const row of signatories.rows) {
    const list = byDecision.get(row.jmm_decision_id) ?? [];
    list.push(row);
    byDecision.set(row.jmm_decision_id, list);
  }

  return decisions.map((decision) => ({
    decision,
    signatories: byDecision.get(decision.id) ?? [],
    quorum: quorum.get(decision.id)!,
  }));
}

/**
 * Business rule 8 — signed decisions are append-only.
 *
 * Once every required `signed_at` is populated, the row is locked. A correction
 * is a new `jmm_decisions` row, exactly as a physically signed form would be
 * corrected by issuing a fresh one. This is the guard callers must clear before
 * any UPDATE on a decision.
 */
export async function isDecisionLocked(decisionId: string): Promise<boolean> {
  const { finalized } = await getQuorumState(decisionId);
  return finalized;
}

/**
 * Records a signature against one signatory slot of `decisionId`. Adding a
 * signature to an already-finalized decision is refused by the caller via
 * `isDecisionLocked`; this only ever moves a slot from unsigned to signed,
 * never the reverse. A slot belonging to another decision is not touched, so
 * the lock the caller checked is the lock of the decision actually signed.
 */
export async function signDecisionSlot(
  decisionId: string,
  signatoryId: string,
  signedAt: string,
): Promise<JmmDecisionSignatoryRow | undefined> {
  return queryOne<JmmDecisionSignatoryRow>(
    `UPDATE jmm_decision_signatories
        SET signed_at = $3
      WHERE id = $2
        AND jmm_decision_id = $1
        AND signed_at IS NULL
      RETURNING ${SIGNATORY_COLUMNS}`,
    [decisionId, signatoryId, signedAt],
  );
}

/**
 * Links (or, with `null`, unlinks) a decision to the meeting it was made at.
 * Rule 8: refused once the decision is fully signed — the link is part of the
 * record. Does not change the complaint's status; the decision already did.
 */
export async function setDecisionMeeting(
  decisionId: string,
  meetingId: string | null,
): Promise<JmmDecisionRow> {
  return withTransaction(async (client) => {
    const locked = await client.query<JmmDecisionRow>(
      `SELECT ${DECISION_COLUMNS} FROM jmm_decisions WHERE id = $1 FOR UPDATE`,
      [decisionId],
    );
    const decision = locked.rows[0];
    if (!decision) throw new DomainError(404, "Keputusan JMM tidak dijumpai");

    if ((await getQuorumState(decisionId, client)).finalized) {
      throw new DomainError(
        409,
        "Keputusan telah ditandatangani sepenuhnya dan dikunci — rekod keputusan baharu untuk pembetulan",
      );
    }
    if (meetingId) {
      await assertComplaintOnMeetingAgenda(
        client,
        meetingId,
        decision.complaint_id,
      );
    }

    const result = await client.query<JmmDecisionRow>(
      `UPDATE jmm_decisions SET meeting_id = $2 WHERE id = $1
       RETURNING ${DECISION_COLUMNS}`,
      [decisionId, meetingId],
    );
    return result.rows[0] ?? decision;
  });
}

export type DecisionLogFilters = {
  outcome?: JmmOutcome;
  from?: string;
  to?: string;
  meetingId?: string;
  limit?: number;
  offset?: number;
};

export type DecisionLogRow = JmmDecisionRow & {
  complaint_ref_no: string;
  complaint_status: ComplaintStatus;
  meeting_no: string | null;
  finalized: boolean;
};

/** The JMM decision log — Integrity Unit only; rule 9 keeps this off public routes. */
export async function listDecisionLog(
  filters: DecisionLogFilters = {},
): Promise<DecisionLogRow[]> {
  const result = await query<DecisionLogRow>(
    `SELECT d.id, d.complaint_id, d.decision_date, d.agency_file_no,
            d.complaint_no_on_form, d.summary, d.jmm_source,
            d.jmm_classification, d.outcome, d.remarks_further_action,
            d.meeting_id, d.created_at,
            c.complaint_ref_no, c.status AS complaint_status,
            m.meeting_no,
            -- Rule 1: finalized = a signed PENGERUSI, a signed AHLI, nothing unsigned.
            COALESCE(q.signed_chairs > 0 AND q.signed_members > 0
                     AND q.unsigned = 0 AND q.total > 0, FALSE) AS finalized
       FROM jmm_decisions d
       JOIN complaints c ON c.id = d.complaint_id
       LEFT JOIN jmm_meetings m ON m.id = d.meeting_id
       LEFT JOIN LATERAL (
              SELECT count(*) FILTER (WHERE role_category = 'PENGERUSI' AND signed_at IS NOT NULL) AS signed_chairs,
                     count(*) FILTER (WHERE role_category = 'AHLI' AND signed_at IS NOT NULL)      AS signed_members,
                     count(*) FILTER (WHERE signed_at IS NULL)                                     AS unsigned,
                     count(*)                                                                      AS total
                FROM jmm_decision_signatories s
               WHERE s.jmm_decision_id = d.id
            ) q ON TRUE
      WHERE ($1::jmm_outcome_enum IS NULL OR d.outcome = $1)
        AND ($2::date IS NULL OR d.decision_date >= $2)
        AND ($3::date IS NULL OR d.decision_date <= $3)
        AND ($4::bigint IS NULL OR d.meeting_id = $4)
      ORDER BY d.decision_date DESC, d.id DESC
      LIMIT $5 OFFSET $6`,
    [
      filters.outcome ?? null,
      filters.from ?? null,
      filters.to ?? null,
      filters.meetingId ?? null,
      Math.min(filters.limit ?? 50, 200),
      filters.offset ?? 0,
    ],
  );
  return result.rows;
}
