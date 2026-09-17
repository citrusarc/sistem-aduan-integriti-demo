import type { PoolClient } from "pg";
import { config } from "../../config.js";
import type { PreparedAttachment } from "../../attachments/files.js";
import { query, queryOne, withTransaction } from "../client.js";
import { DomainError } from "../errors.js";

/**
 * complaint_attachments (migration 011). Integrity Unit only: nothing here is
 * called from a public, complainant or referral route (rule 9).
 */

export type AttachmentRow = {
  id: string;
  complaint_id: string;
  storage_key: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  uploaded_by_staff_id: string | null;
  uploaded_by_name: string | null;
  created_at: Date;
};

const ATTACHMENT_SELECT = `
  SELECT a.id, a.complaint_id, a.storage_key, a.original_name, a.mime_type,
         a.size_bytes, a.sha256, a.uploaded_by_staff_id,
         s.full_name AS uploaded_by_name, a.created_at
    FROM complaint_attachments a
    LEFT JOIN staff_users s ON s.id = a.uploaded_by_staff_id
`;

/**
 * Inserts inside the caller's transaction — createComplaint's, so a
 * submission and its files are registered together or not at all.
 */
export async function insertAttachments(
  client: PoolClient,
  complaintId: string,
  files: readonly PreparedAttachment[],
  staffId: string | null,
): Promise<void> {
  for (const f of files) {
    await client.query(
      `INSERT INTO complaint_attachments (
         complaint_id, storage_key, original_name, mime_type, size_bytes,
         sha256, uploaded_by_staff_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        complaintId,
        f.storageKey,
        f.originalName,
        f.mimeType,
        f.sizeBytes,
        f.sha256,
        staffId,
      ],
    );
  }
}

export async function listAttachments(
  complaintId: string,
): Promise<AttachmentRow[]> {
  const result = await query<AttachmentRow>(
    `${ATTACHMENT_SELECT} WHERE a.complaint_id = $1 ORDER BY a.created_at, a.id`,
    [complaintId],
  );
  return result.rows;
}

export async function getAttachment(
  complaintId: string,
  attachmentId: string,
): Promise<AttachmentRow | undefined> {
  return queryOne<AttachmentRow>(
    `${ATTACHMENT_SELECT} WHERE a.complaint_id = $1 AND a.id = $2`,
    [complaintId, attachmentId],
  );
}

/** Whether the complaint's complainant is anonymous; undefined if no complaint. */
export async function isAnonymousComplaint(
  complaintId: string,
): Promise<boolean | undefined> {
  const row = await queryOne<{ is_anonymous: boolean | null }>(
    `SELECT p.is_anonymous
       FROM complaints c
       LEFT JOIN complainants p ON p.id = c.complainant_id
      WHERE c.id = $1`,
    [complaintId],
  );
  return row ? (row.is_anonymous ?? false) : undefined;
}

/**
 * A staff upload onto an existing case (e.g. documents the complainant
 * emailed later). Locks the complaint row so the per-complaint cap holds under
 * concurrent uploads, and records that the case now has supporting documents.
 */
export async function addStaffAttachments(
  complaintId: string,
  files: readonly PreparedAttachment[],
  staffId: string,
): Promise<AttachmentRow[]> {
  await withTransaction(async (client) => {
    const locked = await client.query(
      `SELECT id FROM complaints WHERE id = $1 FOR UPDATE`,
      [complaintId],
    );
    if (!locked.rowCount) throw new DomainError(404, "Aduan tidak dijumpai");

    const { rows } = await client.query<{ count: string }>(
      `SELECT count(*) FROM complaint_attachments WHERE complaint_id = $1`,
      [complaintId],
    );
    const max = config.uploads.maxFilesPerComplaint;
    if (Number(rows[0]?.count ?? 0) + files.length > max) {
      throw new DomainError(
        409,
        `Satu aduan boleh mempunyai maksimum ${max} dokumen`,
      );
    }

    await insertAttachments(client, complaintId, files, staffId);
    await client.query(
      `UPDATE complaints SET has_supporting_documents = true WHERE id = $1`,
      [complaintId],
    );
  });
  return listAttachments(complaintId);
}
