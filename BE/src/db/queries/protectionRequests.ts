import { query, queryOne, withTransaction } from "../client.js";
import { DomainError } from "../errors.js";
import { PUBLICLY_DISCLOSABLE_SQL } from "./complaints.js";
import type { ProtectionRequestRow } from "../../types/entities.js";
import type {
  ComplaintStatus,
  ProtectionRequestStatus,
} from "../../types/enums.js";

/**
 * Whistleblower protection requests — CLAUDE.md §8 decision 6.
 *
 * Filed by a signed-in complainant for one of their own complaints; reviewed
 * by KUI only. `review_notes` and `reviewed_by` are internal (rule 9) and
 * never reach a complainant-facing shape.
 */

const COLUMNS = `
  id, complaint_id, requested_by_email, reason, status, reviewed_by,
  reviewed_at, review_notes, created_at, updated_at
`;

/**
 * One answer for "no such complaint", "someone else's complaint", and "an NFA
 * complaint" — each must look the same, or the response itself discloses
 * another person's case or an NFA decision (rule 2).
 */
const NOT_YOURS = "Aduan tidak dijumpai";

export async function createProtectionRequest(input: {
  email: string;
  complaintRefNo: string;
  reason: string;
}): Promise<ProtectionRequestRow & { complaint_ref_no: string }> {
  return withTransaction(async (client) => {
    const complaint = await client.query<{ id: string }>(
      `SELECT c.id
         FROM complaints c
        WHERE c.complaint_ref_no = $2
          AND c.complainant_id IN (
                SELECT id FROM complainants WHERE lower(contact_email) = $1
              )
          AND ${PUBLICLY_DISCLOSABLE_SQL}
        FOR UPDATE OF c`,
      [input.email, input.complaintRefNo],
    );
    const complaintId = complaint.rows[0]?.id;
    if (!complaintId) throw new DomainError(404, NOT_YOURS);

    const pending = await client.query(
      `SELECT 1 FROM protection_requests
        WHERE complaint_id = $1 AND status = 'DITERIMA'`,
      [complaintId],
    );
    if (pending.rowCount) {
      throw new DomainError(
        409,
        "Permohonan perlindungan untuk aduan ini sedang disemak",
      );
    }

    const inserted = await client.query<ProtectionRequestRow>(
      `INSERT INTO protection_requests (complaint_id, requested_by_email, reason, status)
       VALUES ($1, $2, $3, 'DITERIMA')
       RETURNING ${COLUMNS}`,
      [complaintId, input.email, input.reason],
    );
    const row = inserted.rows[0];
    if (!row) throw new Error("Gagal merekod permohonan perlindungan");
    return { ...row, complaint_ref_no: input.complaintRefNo };
  });
}

export type ComplainantProtectionRequestRow = ProtectionRequestRow & {
  complaint_ref_no: string;
};

/**
 * A complainant's own requests: filed from their address, for a complaint
 * still linked to it, and still disclosable. A case decided NFA after the
 * request was filed drops out of this list with the complaint (rule 2).
 */
export async function listProtectionRequestsForEmail(
  email: string,
): Promise<ComplainantProtectionRequestRow[]> {
  const result = await query<ComplainantProtectionRequestRow>(
    `SELECT p.id, p.complaint_id, p.requested_by_email, p.reason, p.status,
            p.reviewed_by, p.reviewed_at, p.review_notes, p.created_at,
            p.updated_at, c.complaint_ref_no
       FROM protection_requests p
       JOIN complaints c ON c.id = p.complaint_id
      WHERE p.requested_by_email = $1
        AND c.complainant_id IN (
              SELECT id FROM complainants WHERE lower(contact_email) = $1
            )
        AND ${PUBLICLY_DISCLOSABLE_SQL}
      ORDER BY p.created_at DESC, p.id DESC`,
    [email],
  );
  return result.rows;
}

export type AdminProtectionRequestRow = ProtectionRequestRow & {
  complaint_ref_no: string;
  complaint_status: ComplaintStatus;
  reviewed_by_name: string | null;
};

const ADMIN_SELECT = `
  SELECT p.id, p.complaint_id, p.requested_by_email, p.reason, p.status,
         p.reviewed_by, p.reviewed_at, p.review_notes, p.created_at,
         p.updated_at, c.complaint_ref_no, c.status AS complaint_status,
         s.full_name AS reviewed_by_name
    FROM protection_requests p
    JOIN complaints c ON c.id = p.complaint_id
    LEFT JOIN staff_users s ON s.id = p.reviewed_by
`;

export async function listProtectionRequests(filters: {
  status?: ProtectionRequestStatus;
  limit?: number;
  offset?: number;
}): Promise<AdminProtectionRequestRow[]> {
  const result = await query<AdminProtectionRequestRow>(
    `${ADMIN_SELECT}
      WHERE ($1::protection_request_status_enum IS NULL OR p.status = $1)
      ORDER BY (p.status = 'DITERIMA') DESC, p.created_at DESC, p.id DESC
      LIMIT $2 OFFSET $3`,
    [
      filters.status ?? null,
      Math.min(filters.limit ?? 50, 200),
      filters.offset ?? 0,
    ],
  );
  return result.rows;
}

export async function getProtectionRequest(
  id: string,
): Promise<AdminProtectionRequestRow | undefined> {
  return queryOne<AdminProtectionRequestRow>(
    `${ADMIN_SELECT} WHERE p.id = $1`,
    [id],
  );
}

/** DITERIMA -> DILULUSKAN | DITOLAK, once. A decided request is not re-reviewed. */
export async function reviewProtectionRequest(input: {
  id: string;
  status: Exclude<ProtectionRequestStatus, "DITERIMA">;
  reviewNotes: string | null;
  reviewerId: string;
}): Promise<void> {
  await withTransaction(async (client) => {
    const locked = await client.query<{ status: ProtectionRequestStatus }>(
      `SELECT status FROM protection_requests WHERE id = $1 FOR UPDATE`,
      [input.id],
    );
    const current = locked.rows[0];
    if (!current) {
      throw new DomainError(404, "Permohonan perlindungan tidak dijumpai");
    }
    if (current.status !== "DITERIMA") {
      throw new DomainError(409, "Permohonan ini telah disemak");
    }

    await client.query(
      `UPDATE protection_requests
          SET status = $2, review_notes = $3, reviewed_by = $4,
              reviewed_at = now(), updated_at = now()
        WHERE id = $1`,
      [input.id, input.status, input.reviewNotes, input.reviewerId],
    );
  });
}
