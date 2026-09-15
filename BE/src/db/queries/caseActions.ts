import { query, queryOne, withTransaction } from "../client.js";
import { DomainError } from "../errors.js";
import { PUBLICLY_DISCLOSABLE_SQL } from "./complaints.js";
import { REFERRAL_RECIPIENT_ROLES } from "../../auth/roles.js";
import type { CaseActionRow } from "../../types/entities.js";
import type { CaseActionType } from "../../types/enums.js";

const CASE_ACTION_COLUMNS = `
  id, complaint_id, jmm_decision_id, psu_action_notes, action_taken,
  action_date, response_received_date, feedback_status, ui_remarks,
  file_ref_no, misc_notes, assigned_to_staff_id, created_at, updated_at
`;

export async function listCaseActions(
  complaintId: string,
): Promise<CaseActionRow[]> {
  const result = await query<CaseActionRow>(
    `SELECT ${CASE_ACTION_COLUMNS}
       FROM case_actions
      WHERE complaint_id = $1
      ORDER BY action_date DESC NULLS LAST, id DESC`,
    [complaintId],
  );
  return result.rows;
}

export async function getCaseActionById(
  id: string,
): Promise<CaseActionRow | undefined> {
  return queryOne<CaseActionRow>(
    `SELECT ${CASE_ACTION_COLUMNS} FROM case_actions WHERE id = $1`,
    [id],
  );
}

/**
 * Business rule 4 — `action_taken` is drawn from `case_action_type_enum`, the
 * masterlist's own follow-up vocabulary. It is never derived from, mapped to,
 * or defaulted from `jmm_decisions.outcome`, which is a different list off a
 * different form. Callers pass it explicitly; there is intentionally no
 * convenience that infers one from the other.
 */
export type CreateCaseActionInput = {
  complaintId: string;
  jmmDecisionId?: string | null;
  psuActionNotes?: string | null;
  actionTaken?: CaseActionType | null;
  actionDate?: string | null;
  responseReceivedDate?: string | null;
  feedbackStatus?: string | null;
  uiRemarks?: string | null;
  fileRefNo?: string | null;
  miscNotes?: string | null;
};

export async function createCaseAction(
  input: CreateCaseActionInput,
): Promise<CaseActionRow> {
  const row = await queryOne<CaseActionRow>(
    `INSERT INTO case_actions (
       complaint_id, jmm_decision_id, psu_action_notes, action_taken,
       action_date, response_received_date, feedback_status, ui_remarks,
       file_ref_no, misc_notes
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING ${CASE_ACTION_COLUMNS}`,
    [
      input.complaintId,
      input.jmmDecisionId ?? null,
      input.psuActionNotes ?? null,
      input.actionTaken ?? null,
      input.actionDate ?? null,
      input.responseReceivedDate ?? null,
      input.feedbackStatus ?? null,
      input.uiRemarks ?? null,
      input.fileRefNo ?? null,
      input.miscNotes ?? null,
    ],
  );

  if (!row) throw new Error("Gagal merekod tindakan kes");
  return row;
}

const UPDATABLE_COLUMNS = {
  jmmDecisionId: "jmm_decision_id",
  psuActionNotes: "psu_action_notes",
  actionTaken: "action_taken",
  actionDate: "action_date",
  responseReceivedDate: "response_received_date",
  feedbackStatus: "feedback_status",
  uiRemarks: "ui_remarks",
  fileRefNo: "file_ref_no",
  miscNotes: "misc_notes",
} as const;

export type UpdateCaseActionInput = Partial<
  Record<keyof typeof UPDATABLE_COLUMNS, unknown>
>;

export async function updateCaseAction(
  id: string,
  input: UpdateCaseActionInput,
): Promise<CaseActionRow | undefined> {
  const assignments: string[] = [];
  const params: unknown[] = [];

  for (const [key, column] of Object.entries(UPDATABLE_COLUMNS)) {
    const value = input[key as keyof UpdateCaseActionInput];
    if (value === undefined) continue;
    params.push(value);
    assignments.push(`${column} = $${params.length}`);
  }

  if (!assignments.length) return getCaseActionById(id);

  params.push(id);
  return queryOne<CaseActionRow>(
    `UPDATE case_actions
        SET ${assignments.join(", ")}, updated_at = now()
      WHERE id = $${params.length}
      RETURNING ${CASE_ACTION_COLUMNS}`,
    params,
  );
}

// ─── KJ / sub-unit referral — §8 decision 5 ──────────────────────────────────

/**
 * Integrity Unit: refer an action to a KJ or SUB_UNIT staff member, or clear
 * the referral with `null`.
 *
 *   404  no such action
 *   409  the complaint is NFA, or was ever decided NFA — its actions are never
 *        referred outside the Integrity Unit (rule 2)
 *   422  the assignee isn't an active KJ / SUB_UNIT account
 */
export async function setCaseActionAssignee(
  actionId: string,
  staffId: string | null,
): Promise<CaseActionRow> {
  return withTransaction(async (client) => {
    const locked = await client.query<{ disclosable: boolean }>(
      `SELECT ${PUBLICLY_DISCLOSABLE_SQL} AS disclosable
         FROM case_actions a
         JOIN complaints c ON c.id = a.complaint_id
        WHERE a.id = $1
        FOR UPDATE OF a`,
      [actionId],
    );
    const action = locked.rows[0];
    if (!action) throw new DomainError(404, "Tindakan kes tidak dijumpai");

    if (staffId !== null) {
      if (!action.disclosable) {
        throw new DomainError(
          409,
          "Tindakan bagi aduan NFA tidak boleh dirujuk kepada Ketua Jabatan atau sub-unit",
        );
      }
      const assignee = await client.query(
        `SELECT 1 FROM staff_users
          WHERE id = $1 AND is_active AND role = ANY($2::staff_role_enum[])`,
        [staffId, REFERRAL_RECIPIENT_ROLES],
      );
      if (!assignee.rowCount) {
        throw new DomainError(
          422,
          "Tindakan hanya boleh dirujuk kepada akaun Ketua Jabatan atau sub-unit yang aktif",
        );
      }
    }

    const result = await client.query<CaseActionRow>(
      `UPDATE case_actions
          SET assigned_to_staff_id = $2, updated_at = now()
        WHERE id = $1
        RETURNING ${CASE_ACTION_COLUMNS}`,
      [actionId, staffId],
    );
    return result.rows[0]!;
  });
}

/**
 * Exactly what a KJ / SUB_UNIT assignee may see (§8 decision 5). The query
 * selects nothing else, so internal notes, case description, accused party and
 * JMM data never leave the database for this audience.
 */
export type ReferredActionRow = {
  id: string;
  complaint_ref_no: string;
  action_taken: CaseActionType | null;
  action_date: string | null;
  file_ref_no: string | null;
  response_received_date: string | null;
  feedback_status: string | null;
};

const REFERRED_COLUMNS = `
  a.id, c.complaint_ref_no, a.action_taken, a.action_date, a.file_ref_no,
  a.response_received_date, a.feedback_status
`;

/** The assignee's own actions, never on an NFA (or ever-NFA) complaint. */
export async function listReferredActions(
  staffId: string,
): Promise<ReferredActionRow[]> {
  const result = await query<ReferredActionRow>(
    `SELECT ${REFERRED_COLUMNS}
       FROM case_actions a
       JOIN complaints c ON c.id = a.complaint_id
      WHERE a.assigned_to_staff_id = $1
        AND ${PUBLICLY_DISCLOSABLE_SQL}
      ORDER BY a.action_date DESC NULLS LAST, a.id DESC`,
    [staffId],
  );
  return result.rows;
}

/**
 * The only write an assignee has: `response_received_date` and
 * `feedback_status`, on their own action on a disclosable complaint. Anything
 * else — not assigned to them, NFA, missing — returns undefined, so the caller
 * answers all of them with the same 404.
 */
export async function updateReferredAction(
  staffId: string,
  actionId: string,
  input: {
    responseReceivedDate?: string | null;
    feedbackStatus?: string | null;
  },
): Promise<ReferredActionRow | undefined> {
  const assignments: string[] = [];
  const params: unknown[] = [actionId, staffId];
  if (input.responseReceivedDate !== undefined) {
    params.push(input.responseReceivedDate);
    assignments.push(`response_received_date = $${params.length}`);
  }
  if (input.feedbackStatus !== undefined) {
    params.push(input.feedbackStatus);
    assignments.push(`feedback_status = $${params.length}`);
  }
  if (!assignments.length) return undefined;

  return queryOne<ReferredActionRow>(
    `UPDATE case_actions a
        SET ${assignments.join(", ")}, updated_at = now()
       FROM complaints c
      WHERE a.id = $1
        AND a.assigned_to_staff_id = $2
        AND c.id = a.complaint_id
        AND ${PUBLICLY_DISCLOSABLE_SQL}
      RETURNING ${REFERRED_COLUMNS}`,
    params,
  );
}
