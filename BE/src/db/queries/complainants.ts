import { queryOne } from "../client.js";
import type { ComplainantRow } from "../../types/entities.js";
import type { GradeLevelGroup } from "../../types/enums.js";

const COMPLAINANT_COLUMNS = `
  id, particulars, grade_level, contact_email, contact_phone, is_anonymous,
  complainant_category, ic_no, passport_no, age, gender, race, nationality,
  contact_phone_2, postal_address, occupation, employer, created_at
`;

export async function getComplainantById(
  id: string,
): Promise<ComplainantRow | undefined> {
  return queryOne<ComplainantRow>(
    `SELECT ${COMPLAINANT_COLUMNS} FROM complainants WHERE id = $1`,
    [id],
  );
}

/**
 * Particulars and grade only. Complaint registration inserts complainants
 * itself (with contact details and anonymity) inside its own transaction — see
 * createComplaint in complaints.ts. Never stuff an email into `particulars`.
 */
export async function createComplainant(input: {
  particulars?: string | null;
  gradeLevel?: GradeLevelGroup | null;
}): Promise<ComplainantRow> {
  const row = await queryOne<ComplainantRow>(
    `INSERT INTO complainants (particulars, grade_level)
     VALUES ($1, $2)
     RETURNING ${COMPLAINANT_COLUMNS}`,
    [input.particulars ?? null, input.gradeLevel ?? null],
  );

  if (!row) throw new Error("Gagal merekod butiran pengadu");
  return row;
}
