import type { PoolClient } from "pg";
import { query, queryOne, withTransaction } from "../client.js";
import { transition, type StatusEvent } from "../complaintStatus.js";
import { DomainError } from "../errors.js";
import { malaysiaToday } from "../reportPeriod.js";
import { insertAttachments } from "./attachments.js";
import type { PreparedAttachment } from "../../attachments/files.js";
import type { ComplaintRow } from "../../types/entities.js";
import type { ComplaintStatus } from "../../types/enums.js";

const COMPLAINT_COLUMNS = `
  id, seq_no, report_month, report_year, directed_to, complaint_ref_no,
  complainant_id, source_channel, accused_particulars, accused_grade_level,
  accused_department, accused_position, accused2_particulars,
  accused2_department, accused2_position, info_classification,
  integrity_category, sector, case_description, complaint_date,
  received_date_ui, incident_date, incident_time, has_supporting_documents,
  received_via, status, status_changed_at, disclaimer_acknowledged_at,
  suspected_duplicate_of_complaint_id, duplicate_score, duplicate_reasons,
  duplicate_of_complaint_id, created_at, updated_at
`;

/**
 * A complaint's period date: its `received_date_ui` (TARIKH TERIMA DI UI),
 * falling back to `complaint_date`, then the day it was registered here. The
 * masterlist's own `report_month` is free text with no fixed format, so it
 * can't be grouped or filtered reliably. Stats and the register's period filter
 * share this one definition, so a month's count and its list always agree.
 */
export const PERIOD_DATE_SQL =
  "COALESCE(received_date_ui, complaint_date, (created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date)";

export type ComplaintFilters = {
  reportYear?: number;
  reportMonth?: string;
  integrityCategory?: string;
  sourceChannel?: string;
  sector?: string;
  status?: ComplaintStatus;
  /** §8 decision 16: only complaints still carrying a duplicate suspicion. */
  suspectedDuplicate?: boolean;
  /** Inclusive 'YYYY-MM-DD' bounds on PERIOD_DATE_SQL. */
  from?: string;
  to?: string;
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
  if (filters.suspectedDuplicate) {
    conditions.push("suspected_duplicate_of_complaint_id IS NOT NULL");
  }
  if (filters.from !== undefined) {
    add(`${PERIOD_DATE_SQL} >= $?::date`, filters.from);
  }
  if (filters.to !== undefined) {
    add(`${PERIOD_DATE_SQL} <= $?::date`, filters.to);
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
 * re-tabling a case does not make it disclosable again. Also hidden: a PENDUA
 * complaint whose original is (or ever was) NFA (§8 decision 16) — "this
 * repeats an existing case" would confirm that the NFA case exists.
 */
export const PUBLICLY_DISCLOSABLE_SQL = `(
  c.status <> 'NFA'
  AND NOT EXISTS (
        SELECT 1 FROM jmm_decisions d
         WHERE d.complaint_id = c.id AND d.outcome = 'NFA'
      )
  AND NOT EXISTS (
        SELECT 1 FROM complaints o
         WHERE o.id = c.duplicate_of_complaint_id
           AND (o.status = 'NFA'
                OR EXISTS (SELECT 1 FROM jmm_decisions od
                            WHERE od.complaint_id = o.id AND od.outcome = 'NFA'))
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
 * a rolling window. Lampiran 2 names up to two accused people; each name given
 * is matched against both accused slots of existing cases, since the same
 * person can be listed first on one form and second on another.
 */
export async function findDuplicateCandidates(input: {
  accusedParticulars?: string | null;
  accusedDepartment?: string | null;
  accused2Particulars?: string | null;
  accused2Department?: string | null;
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
      -- Period date, not received_date_ui alone: a complaint without a received
      -- date must still be found as a possible repeat.
      WHERE ${PERIOD_DATE_SQL} >= CURRENT_DATE - ($4::int * INTERVAL '1 day')
        AND (
              EXISTS (
                SELECT 1
                  FROM unnest(ARRAY[$1::text, $6::text]) AS given(name)
                 WHERE given.name IS NOT NULL
                   AND (c.accused_particulars  ILIKE '%' || given.name || '%'
                     OR c.accused2_particulars ILIKE '%' || given.name || '%')
              )
           OR EXISTS (
                SELECT 1
                  FROM unnest(ARRAY[$2::text, $7::text]) AS given(dept)
                 WHERE given.dept IS NOT NULL
                   AND (c.accused_department  ILIKE '%' || given.dept || '%'
                     OR c.accused2_department ILIKE '%' || given.dept || '%')
              )
           OR ($3::text IS NOT NULL AND similarity(c.case_description, $3) > 0.45)
        )
        AND (NOT $5::boolean OR ${PUBLICLY_DISCLOSABLE_SQL})
      ORDER BY ${PERIOD_DATE_SQL} DESC, c.id DESC
      LIMIT 20`,
    [
      input.accusedParticulars ?? null,
      input.accusedDepartment ?? null,
      input.caseDescription ?? null,
      input.withinDays ?? 365,
      input.excludeNfa ?? false,
      input.accused2Particulars ?? null,
      input.accused2Department ?? null,
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
  // Concurrent registrations would otherwise read the same MAX(seq_no) and all
  // but one fail on the unique index. The lock is per year and released at
  // commit, so numbering stays gap-free and nobody gets a 500.
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    `complaint_ref_no:${year}`,
  ]);
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
  accusedPosition?: string | null;
  accused2Particulars?: string | null;
  accused2Department?: string | null;
  accused2Position?: string | null;
  infoClassification?: string | null;
  integrityCategory?: string | null;
  sector?: string | null;
  caseDescription?: string | null;
  complaintDate?: string | null;
  receivedDateUi?: string | null;
  incidentDate?: string | null;
  incidentTime?: string | null;
  hasSupportingDocuments?: boolean | null;
  receivedVia?: string | null;
  complainant?: {
    particulars?: string | null;
    gradeLevel?: string | null;
    /** Lower-cased by validation. */
    contactEmail?: string | null;
    /** Stored for staff to call by hand; nothing sends to it (rule 10). */
    contactPhone?: string | null;
    isAnonymous?: boolean;
    complainantCategory?: string | null;
    icNo?: string | null;
    passportNo?: string | null;
    age?: number | null;
    gender?: string | null;
    race?: string | null;
    nationality?: string | null;
    /** As contactPhone: staff call it by hand, nothing sends to it. */
    contactPhone2?: string | null;
    postalAddress?: string | null;
    occupation?: string | null;
    employer?: string | null;
  } | null;
  /** Portal submissions: the handling disclaimer was acknowledged just now. */
  disclaimerAcknowledged?: boolean;
  /**
   * Supporting documents already written to disk (§8 decision 10), registered
   * in this transaction. If it rolls back, the caller removes the files.
   */
  attachments?: readonly PreparedAttachment[];
  /** Who uploaded them; null for a portal submission. */
  uploadedByStaffId?: string | null;
  /** §8 decision 16: from assessDuplicate(), stored for staff to review. */
  suspectedDuplicate?: {
    complaintId: string;
    score: number;
    reasons: readonly string[];
  } | null;
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
      const p = input.complainant;
      // Validation refuses every detail on an anonymous submission (§8
      // decision 11); this nulls them again so nothing is stored even if a
      // caller skipped validation. Check constraints 010 and 012 backstop it.
      const identifying = <T>(value: T | null | undefined) =>
        p.isAnonymous ? null : (value ?? null);
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO complainants (
           particulars, grade_level, contact_email, contact_phone, is_anonymous,
           complainant_category, ic_no, passport_no, age, gender, race,
           nationality, contact_phone_2, postal_address, occupation, employer
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         RETURNING id`,
        [
          identifying(p.particulars),
          identifying(p.gradeLevel),
          identifying(p.contactEmail),
          identifying(p.contactPhone),
          p.isAnonymous ?? false,
          identifying(p.complainantCategory),
          identifying(p.icNo),
          identifying(p.passportNo),
          identifying(p.age),
          identifying(p.gender),
          identifying(p.race),
          identifying(p.nationality),
          identifying(p.contactPhone2),
          identifying(p.postalAddress),
          identifying(p.occupation),
          identifying(p.employer),
        ],
      );
      complainantId = inserted.rows[0]?.id ?? null;
    }

    // Default to the year in Malaysia, not the server's clock.
    const year = input.reportYear ?? malaysiaToday().reportYear;
    const refNo = await nextRefNo(client, year);
    const seqNo = Number(refNo.slice(refNo.lastIndexOf("/") + 1));

    const result = await client.query<ComplaintRow>(
      `INSERT INTO complaints (
         seq_no, report_month, report_year, directed_to, complaint_ref_no,
         complainant_id, source_channel, accused_particulars,
         accused_grade_level, accused_department, info_classification,
         integrity_category, sector, case_description, complaint_date,
         received_date_ui, status, disclaimer_acknowledged_at,
         accused_position, accused2_particulars, accused2_department,
         accused2_position, incident_date, incident_time,
         has_supporting_documents, received_via,
         suspected_duplicate_of_complaint_id, duplicate_score, duplicate_reasons
       )
       -- §8 decision 1: a new complaint is BARU, written explicitly rather
       -- than left to the column default.
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'BARU',
               CASE WHEN $17::boolean THEN now() END,
               $18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)
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
        input.accusedPosition ?? null,
        input.accused2Particulars ?? null,
        input.accused2Department ?? null,
        input.accused2Position ?? null,
        input.incidentDate ?? null,
        input.incidentTime ?? null,
        input.hasSupportingDocuments ?? null,
        input.receivedVia ?? null,
        input.suspectedDuplicate?.complaintId ?? null,
        input.suspectedDuplicate?.score ?? null,
        input.suspectedDuplicate ? [...input.suspectedDuplicate.reasons] : null,
      ],
    );

    const row = result.rows[0];
    if (!row) throw new Error("Gagal mendaftarkan aduan");
    await recordStatusHistory(client, row.id, null, "BARU");
    if (input.attachments?.length) {
      await insertAttachments(
        client,
        row.id,
        input.attachments,
        input.uploadedByStaffId ?? null,
      );
    }
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
  accusedPosition: "accused_position",
  accused2Particulars: "accused2_particulars",
  accused2Department: "accused2_department",
  accused2Position: "accused2_position",
  infoClassification: "info_classification",
  integrityCategory: "integrity_category",
  sector: "sector",
  caseDescription: "case_description",
  complaintDate: "complaint_date",
  receivedDateUi: "received_date_ui",
  incidentDate: "incident_date",
  incidentTime: "incident_time",
  hasSupportingDocuments: "has_supporting_documents",
  receivedVia: "received_via",
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
    await recordStatusHistory(
      client,
      complaint.id,
      complaint.status,
      result.to,
    );
  }
  return result.to;
}

/**
 * §8 decision 13 — one row per status entered, written in the same
 * transaction as the status itself. Called only from createComplaint and
 * applyStatusEvent, the two writers of complaints.status.
 */
async function recordStatusHistory(
  client: PoolClient,
  complaintId: string,
  from: ComplaintStatus | null,
  to: ComplaintStatus,
): Promise<void> {
  await client.query(
    `INSERT INTO complaint_status_history (complaint_id, from_status, to_status)
     VALUES ($1, $2, $3)`,
    [complaintId, from, to],
  );
}

export type StatusHistoryRow = {
  to_status: ComplaintStatus;
  changed_at: Date;
};

/** Oldest first. Callers decide whether the complaint may be disclosed. */
export async function listStatusHistory(
  complaintId: string,
): Promise<StatusHistoryRow[]> {
  const result = await query<StatusHistoryRow>(
    `SELECT to_status, changed_at
       FROM complaint_status_history
      WHERE complaint_id = $1
      ORDER BY changed_at, id`,
    [complaintId],
  );
  return result.rows;
}

/** Staff closes a case: DALAM_TINDAKAN -> SELESAI. */
export async function closeComplaint(id: string): Promise<ComplaintRow> {
  return withTransaction(async (client) => {
    const complaint = await lockComplaint(client, id);
    await applyStatusEvent(client, complaint, { type: "CASE_CLOSED" });
    return lockComplaint(client, id);
  });
}

// ─── Duplicates — §8 decision 16 ─────────────────────────────────────────────

export type DuplicatePoolRow = {
  id: string;
  complaint_ref_no: string;
  accused_particulars: string | null;
  accused2_particulars: string | null;
  accused_department: string | null;
  accused2_department: string | null;
  case_description: string | null;
  contact_email: string | null;
};

/**
 * Existing complaints worth scoring against a new one: within a year, not
 * themselves PENDUA (a repeat points at the original), and sharing at least
 * something — the complainant's email, an accused name or agency, or a loose
 * trigram match on the description. Loose on purpose: assessDuplicate()
 * decides. Includes NFA cases: the result is internal to the Integrity Unit.
 */
export async function listDuplicatePool(input: {
  accusedNames: readonly string[];
  departments: readonly string[];
  caseDescription: string | null;
  contactEmail: string | null;
}): Promise<DuplicatePoolRow[]> {
  const result = await query<DuplicatePoolRow>(
    `WITH recent AS (
       -- Filtered before the join: PERIOD_DATE_SQL names unqualified columns.
       SELECT * FROM complaints
        WHERE status <> 'PENDUA'
          AND ${PERIOD_DATE_SQL} >= CURRENT_DATE - INTERVAL '365 days'
     )
     SELECT c.id, c.complaint_ref_no, c.accused_particulars,
            c.accused2_particulars, c.accused_department, c.accused2_department,
            c.case_description, lower(p.contact_email) AS contact_email
       FROM recent c
       LEFT JOIN complainants p ON p.id = c.complainant_id
      WHERE (
              ($4::text IS NOT NULL AND lower(p.contact_email) = $4)
           OR EXISTS (SELECT 1 FROM unnest($1::text[]) AS n(name)
                       WHERE c.accused_particulars  ILIKE '%' || n.name || '%'
                          OR c.accused2_particulars ILIKE '%' || n.name || '%')
           OR EXISTS (SELECT 1 FROM unnest($2::text[]) AS d(dept)
                       WHERE c.accused_department  ILIKE '%' || d.dept || '%'
                          OR c.accused2_department ILIKE '%' || d.dept || '%')
           OR ($3::text IS NOT NULL AND similarity(c.case_description, $3) > 0.2)
        )
      ORDER BY c.id DESC
      LIMIT 50`,
    [
      input.accusedNames,
      input.departments,
      input.caseDescription,
      input.contactEmail,
    ],
  );
  return result.rows;
}

/** Recent descriptions, for word rarity (IDF). Newest first. */
export async function listRecentDescriptions(limit = 1000): Promise<string[]> {
  const result = await query<{ case_description: string }>(
    `SELECT case_description FROM complaints
      WHERE case_description IS NOT NULL
      ORDER BY id DESC LIMIT $1`,
    [limit],
  );
  return result.rows.map((r) => r.case_description);
}

/**
 * Complaints registered with this contact email in the last `hours` — the
 * acknowledgement emails it has been sent, near enough. `email` lower-cased.
 */
export async function countRecentComplaintsForEmail(
  email: string,
  hours: number,
): Promise<number> {
  const row = await queryOne<{ n: number }>(
    `SELECT count(*)::int AS n
       FROM complaints c
       JOIN complainants p ON p.id = c.complainant_id
      WHERE lower(p.contact_email) = $1
        AND c.created_at > now() - ($2::int * INTERVAL '1 hour')`,
    [email, hours],
  );
  return row?.n ?? 0;
}

/**
 * Staff confirm a repeat: BARU -> PENDUA, pointing at the original. The
 * original must exist, differ, and not itself be PENDUA (point at the case
 * that is actually being handled). The suspicion is cleared: it's decided.
 */
export async function confirmDuplicate(
  id: string,
  originalId: string,
): Promise<ComplaintRow> {
  return withTransaction(async (client) => {
    if (id === originalId) {
      throw new DomainError(
        422,
        "Aduan tidak boleh menjadi pendua dirinya sendiri",
      );
    }
    const complaint = await lockComplaint(client, id);
    const original = await client.query<{ status: ComplaintStatus }>(
      `SELECT status FROM complaints WHERE id = $1`,
      [originalId],
    );
    const originalStatus = original.rows[0]?.status;
    if (!originalStatus) {
      throw new DomainError(422, "Aduan asal tidak dijumpai");
    }
    if (originalStatus === "PENDUA") {
      throw new DomainError(
        422,
        "Aduan asal itu sendiri ialah pendua — pilih aduan yang sedang diproses",
      );
    }
    await client.query(
      `UPDATE complaints
          SET duplicate_of_complaint_id = $2,
              suspected_duplicate_of_complaint_id = NULL,
              duplicate_score = NULL, duplicate_reasons = NULL
        WHERE id = $1`,
      [id, originalId],
    );
    await applyStatusEvent(client, complaint, { type: "DUPLICATE_CONFIRMED" });
    return lockComplaint(client, id);
  });
}

/** Staff undo a PENDUA: back to BARU, no longer pointing at anything. */
export async function undoDuplicate(id: string): Promise<ComplaintRow> {
  return withTransaction(async (client) => {
    const complaint = await lockComplaint(client, id);
    await applyStatusEvent(client, complaint, { type: "DUPLICATE_UNDONE" });
    await client.query(
      `UPDATE complaints SET duplicate_of_complaint_id = NULL WHERE id = $1`,
      [id],
    );
    return lockComplaint(client, id);
  });
}

/** Staff decide the suspicion was wrong. Moves no status. */
export async function dismissDuplicateSuspicion(
  id: string,
): Promise<ComplaintRow | undefined> {
  return queryOne<ComplaintRow>(
    `UPDATE complaints
        SET suspected_duplicate_of_complaint_id = NULL,
            duplicate_score = NULL, duplicate_reasons = NULL,
            updated_at = now()
      WHERE id = $1
      RETURNING ${COMPLAINT_COLUMNS}`,
    [id],
  );
}
