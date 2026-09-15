import type { PoolClient } from "pg";
import { query, queryOne, withTransaction } from "../client.js";
import { transition, type StatusEvent } from "../complaintStatus.js";
import { DomainError } from "../errors.js";
import type { ComplaintRow } from "../../types/entities.js";
import type { ComplaintStatus } from "../../types/enums.js";

const COMPLAINT_COLUMNS = `
  id, seq_no, report_month, report_year, directed_to, complaint_ref_no,
  complainant_id, source_channel, accused_particulars, accused_grade_level,
  accused_department, info_classification, integrity_category, sector,
  case_description, complaint_date, received_date_ui, status,
  status_changed_at, disclaimer_acknowledged_at, created_at, updated_at
`;

export type ComplaintFilters = {
  reportYear?: number;
  reportMonth?: string;
  integrityCategory?: string;
  sourceChannel?: string;
  sector?: string;
  status?: ComplaintStatus;
  limit?: number;
  offset?: number;
};

export async function listComplaints(
  filters: ComplaintFilters = {},
): Promise<ComplaintRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  const add = (sql: string, value: unknown) => {
    params.push(value);
    conditions.push(sql.replace("$?", `$${params.length}`));
  };

  if (filters.reportYear !== undefined) {
    add("report_year = $?", filters.reportYear);
  }
  if (filters.reportMonth !== undefined) {
    add("report_month = $?", filters.reportMonth);
  }
  if (filters.integrityCategory !== undefined) {
    add("integrity_category = $?", filters.integrityCategory);
  }
  if (filters.sourceChannel !== undefined) {
    add("source_channel = $?", filters.sourceChannel);
  }
  if (filters.sector !== undefined) {
    add("sector = $?", filters.sector);
  }
  if (filters.status !== undefined) {
    add("status = $?", filters.status);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(Math.min(filters.limit ?? 50, 200));
  const limitParam = `$${params.length}`;
  params.push(filters.offset ?? 0);
  const offsetParam = `$${params.length}`;

  const result = await query<ComplaintRow>(
    `SELECT ${COMPLAINT_COLUMNS}
       FROM complaints
       ${where}
      ORDER BY received_date_ui DESC NULLS LAST, id DESC
      LIMIT ${limitParam} OFFSET ${offsetParam}`,
    params,
  );
  return result.rows;
}

export async function getComplaintById(
  id: string,
): Promise<ComplaintRow | undefined> {
  return queryOne<ComplaintRow>(
    `SELECT ${COMPLAINT_COLUMNS} FROM complaints WHERE id = $1`,
    [id],
  );
}

export async function getComplaintByRefNo(
  refNo: string,
): Promise<ComplaintRow | undefined> {
  return queryOne<ComplaintRow>(
    `SELECT ${COMPLAINT_COLUMNS} FROM complaints WHERE complaint_ref_no = $1`,
    [refNo],
  );
}

/**
 * Business rule 2 — NFA confidentiality, as one SQL predicate over a
 * `complaints` row aliased `c`. Every query that can answer anyone outside the
 * Integrity Unit (public tracking, the public duplicate check, a signed-in
 * complainant's own complaints and protection requests) uses this, so the rule
 * has exactly one definition.
 *
 * Hidden: status NFA, and any complaint that has EVER had an NFA decision —
 * re-tabling a case does not make it disclosable again.
 */
export const PUBLICLY_DISCLOSABLE_SQL = `(
  c.status <> 'NFA'
  AND NOT EXISTS (
        SELECT 1 FROM jmm_decisions d
         WHERE d.complaint_id = c.id AND d.outcome = 'NFA'
      )
)`;

/**
 * Public tracking lookup. Callers get `undefined` for an NFA case and must
 * answer exactly as they would for a reference number that does not exist —
 * an NFA case must not be distinguishable from a missing one.
 */
export async function getPubliclyDisclosableComplaintByRefNo(
  refNo: string,
): Promise<ComplaintRow | undefined> {
  return queryOne<ComplaintRow>(
    `SELECT ${COMPLAINT_COLUMNS}
       FROM complaints c
      WHERE c.complaint_ref_no = $1
        AND ${PUBLICLY_DISCLOSABLE_SQL}`,
    [refNo],
  );
}

/**
 * §8 decision 4 — a complainant's own complaints: those whose complainant row
 * carries this contact email. Rule 2 applies to the complainant too; an NFA
 * case is not listed, and a lookup for it answers like an unknown one.
 * `email` must already be lower-cased (emailSchema does that).
 */
export async function listDisclosableComplaintsForEmail(
  email: string,
): Promise<ComplaintRow[]> {
  const result = await query<ComplaintRow>(
    `SELECT ${COMPLAINT_COLUMNS}
       FROM complaints c
      WHERE c.complainant_id IN (
              SELECT id FROM complainants WHERE lower(contact_email) = $1
            )
        AND ${PUBLICLY_DISCLOSABLE_SQL}
      ORDER BY c.created_at DESC, c.id DESC`,
    [email],
  );
  return result.rows;
}

export async function getDisclosableComplaintForEmail(
  email: string,
  refNo: string,
): Promise<ComplaintRow | undefined> {
  return queryOne<ComplaintRow>(
    `SELECT ${COMPLAINT_COLUMNS}
       FROM complaints c
      WHERE c.complaint_ref_no = $2
        AND c.complainant_id IN (
              SELECT id FROM complainants WHERE lower(contact_email) = $1
            )
        AND ${PUBLICLY_DISCLOSABLE_SQL}`,
    [email, refNo],
  );
}

/**
 * Business rule 5 — duplicate/repeat check before registration.
 *
 * Deliberately recall-biased: it is cheap for staff to dismiss a false match
 * and expensive to register a repeat complaint as a brand-new case. Matches on
 * the same accused party, or on a strongly overlapping case description, within
 * a rolling window.
 */
export async function findDuplicateCandidates(input: {
  accusedParticulars?: string | null;
  accusedDepartment?: string | null;
  caseDescription?: string | null;
  withinDays?: number;
  /**
   * Business rule 2: when the check runs for a public portal submission, NFA
   * cases must be excluded. Otherwise a member of the public could confirm an
   * NFA case exists just by submitting a complaint that matches it.
   */
  excludeNfa?: boolean;
}): Promise<ComplaintRow[]> {
  const result = await query<ComplaintRow>(
    `SELECT ${COMPLAINT_COLUMNS}
       FROM complaints c
      WHERE c.received_date_ui >= CURRENT_DATE - ($4::int * INTERVAL '1 day')
        AND (
              ($1::text IS NOT NULL AND c.accused_particulars ILIKE '%' || $1 || '%')
           OR ($2::text IS NOT NULL AND c.accused_department  ILIKE '%' || $2 || '%')
           OR ($3::text IS NOT NULL AND similarity(c.case_description, $3) > 0.45)
        )
        AND (NOT $5::boolean OR ${PUBLICLY_DISCLOSABLE_SQL})
      ORDER BY c.received_date_ui DESC
      LIMIT 20`,
    [
      input.accusedParticulars ?? null,
      input.accusedDepartment ?? null,
      input.caseDescription ?? null,
      input.withinDays ?? 365,
      input.excludeNfa ?? false,
    ],
  );
  return result.rows;
}

/**
 * Business rule 7 — `complaint_ref_no` is immutable once issued.
 *
 * Generated once, inside the same transaction as the INSERT, and never exposed
 * as an updatable field. Format: UI/<year>/<zero-padded sequence within year>.
 */
async function nextRefNo(client: PoolClient, year: number): Promise<string> {
  const result = await client.query<{ next_seq: string }>(
    `SELECT COALESCE(MAX(seq_no), 0) + 1 AS next_seq
       FROM complaints
      WHERE report_year = $1`,
    [year],
  );
  const seq = Number(result.rows[0]?.next_seq ?? 1);
  return `UI/${year}/${String(seq).padStart(5, "0")}`;
}

export type CreateComplaintInput = {
  reportMonth?: string | null;
  reportYear?: number | null;
  directedTo?: string | null;
  sourceChannel?: string | null;
  accusedParticulars?: string | null;
  accusedGradeLevel?: string | null;
  accusedDepartment?: string | null;
  infoClassification?: string | null;
  integrityCategory?: string | null;
  sector?: string | null;
  caseDescription?: string | null;
  complaintDate?: string | null;
  receivedDateUi?: string | null;
  complainant?: {
    particulars?: string | null;
    gradeLevel?: string | null;
    /** Lower-cased by validation. */
    contactEmail?: string | null;
    /** Stored for staff to call by hand; nothing sends to it (rule 10). */
    contactPhone?: string | null;
    isAnonymous?: boolean;
  } | null;
  /** Portal submissions: the handling disclaimer was acknowledged just now. */
  disclaimerAcknowledged?: boolean;
};

/**
 * Inserts the complainant (when given) and the complaint together, so a failed
 * complaint insert cannot leave an orphan complainant behind. The reference
 * number and `seq_no` are allocated inside the same transaction; concurrent
 * registrations serialise on the unique index on `complaint_ref_no`.
 */
export async function createComplaint(
  input: CreateComplaintInput,
): Promise<ComplaintRow> {
  return withTransaction(async (client) => {
    let complainantId: string | null = null;

    if (input.complainant) {
      const inserted = await client.query<{ id: string }>(
        // Anonymous rows keep no particulars; the check constraint from
        // migration 006 refuses one that tries.
        `INSERT INTO complainants (
           particulars, grade_level, contact_email, contact_phone, is_anonymous
         )
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [
          input.complainant.isAnonymous
            ? null
            : (input.complainant.particulars ?? null),
          input.complainant.gradeLevel ?? null,
          input.complainant.contactEmail ?? null,
          input.complainant.contactPhone ?? null,
          input.complainant.isAnonymous ?? false,
        ],
      );
      complainantId = inserted.rows[0]?.id ?? null;
    }

    const year = input.reportYear ?? new Date().getFullYear();
    const refNo = await nextRefNo(client, year);
    const seqNo = Number(refNo.slice(refNo.lastIndexOf("/") + 1));

    const result = await client.query<ComplaintRow>(
      `INSERT INTO complaints (
         seq_no, report_month, report_year, directed_to, complaint_ref_no,
         complainant_id, source_channel, accused_particulars,
         accused_grade_level, accused_department, info_classification,
         integrity_category, sector, case_description, complaint_date,
         received_date_ui, status, disclaimer_acknowledged_at
       )
       -- §8 decision 1: a new complaint is BARU, written explicitly rather
       -- than left to the column default.
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'BARU',
               CASE WHEN $17::boolean THEN now() END)
       RETURNING ${COMPLAINT_COLUMNS}`,
      [
        seqNo,
        input.reportMonth ?? null,
        year,
        input.directedTo ?? null,
        refNo,
        complainantId,
        input.sourceChannel ?? null,
        input.accusedParticulars ?? null,
        input.accusedGradeLevel ?? null,
        input.accusedDepartment ?? null,
        input.infoClassification ?? null,
        input.integrityCategory ?? null,
        input.sector ?? null,
        input.caseDescription ?? null,
        input.complaintDate ?? null,
        input.receivedDateUi ?? null,
        input.disclaimerAcknowledged ?? false,
      ],
    );

    const row = result.rows[0];
    if (!row) throw new Error("Gagal mendaftarkan aduan");
    return row;
  });
}

/**
 * Updatable fields only. `complaint_ref_no`, `seq_no`, `id` and `created_at`
 * are absent by design — business rule 7 makes the reference number immutable
 * once the acknowledgement has been issued.
 */
const UPDATABLE_COLUMNS = {
  reportMonth: "report_month",
  reportYear: "report_year",
  directedTo: "directed_to",
  sourceChannel: "source_channel",
  accusedParticulars: "accused_particulars",
  accusedGradeLevel: "accused_grade_level",
  accusedDepartment: "accused_department",
  infoClassification: "info_classification",
  integrityCategory: "integrity_category",
  sector: "sector",
  caseDescription: "case_description",
  complaintDate: "complaint_date",
  receivedDateUi: "received_date_ui",
} as const;

export type UpdateComplaintInput = Partial<
  Record<keyof typeof UPDATABLE_COLUMNS, unknown>
>;

export async function updateComplaint(
  id: string,
  input: UpdateComplaintInput,
): Promise<ComplaintRow | undefined> {
  const assignments: string[] = [];
  const params: unknown[] = [];

  for (const [key, column] of Object.entries(UPDATABLE_COLUMNS)) {
    const value = input[key as keyof UpdateComplaintInput];
    if (value === undefined) continue;
    params.push(value);
    assignments.push(`${column} = $${params.length}`);
  }

  if (!assignments.length) return getComplaintById(id);

  params.push(id);
  return queryOne<ComplaintRow>(
    `UPDATE complaints
        SET ${assignments.join(", ")}, updated_at = now()
      WHERE id = $${params.length}
      RETURNING ${COMPLAINT_COLUMNS}`,
    params,
  );
}

/**
 * Locks one complaint row for the rest of the transaction. Every status
 * transition goes through this first, so two concurrent requests (say, a
 * decision being recorded while the item is removed from the agenda) are
 * applied one after the other against the real current status.
 */
export async function lockComplaint(
  client: PoolClient,
  id: string,
): Promise<ComplaintRow> {
  const result = await client.query<ComplaintRow>(
    `SELECT ${COMPLAINT_COLUMNS} FROM complaints WHERE id = $1 FOR UPDATE`,
    [id],
  );
  const row = result.rows[0];
  if (!row) throw new DomainError(404, "Aduan tidak dijumpai");
  return row;
}

/**
 * §8 decision 1 — the only writer of `complaints.status`.
 *
 * Asks the transition table whether `event` is allowed from the locked row's
 * current status; refuses with 409 if not. Touches `status_changed_at` only
 * when the status actually changes, so it stays meaningful for ageing reports.
 * Call inside the transaction that holds `lockComplaint`.
 */
export async function applyStatusEvent(
  client: PoolClient,
  complaint: ComplaintRow,
  event: StatusEvent,
): Promise<ComplaintStatus> {
  const result = transition(complaint.status, event);
  if (!result.ok) throw new DomainError(409, result.reason);

  if (result.to !== complaint.status) {
    await client.query(
      `UPDATE complaints
          SET status = $2, status_changed_at = now(), updated_at = now()
        WHERE id = $1`,
      [complaint.id, result.to],
    );
  }
  return result.to;
}

/** Staff closes a case: DALAM_TINDAKAN -> SELESAI. */
export async function closeComplaint(id: string): Promise<ComplaintRow> {
  return withTransaction(async (client) => {
    const complaint = await lockComplaint(client, id);
    await applyStatusEvent(client, complaint, { type: "CASE_CLOSED" });
    return lockComplaint(client, id);
  });
}
