import { query, queryOne } from "../client.js";
import type { StaffUserRow } from "../../types/entities.js";

const STAFF_COLUMNS = `id, full_name, role, email, is_active, created_at`;

export async function listActiveStaff(): Promise<StaffUserRow[]> {
  const result = await query<StaffUserRow>(
    `SELECT ${STAFF_COLUMNS}
       FROM staff_users
      WHERE is_active
      ORDER BY full_name`,
  );
  return result.rows;
}

export async function getStaffById(
  id: string,
): Promise<StaffUserRow | undefined> {
  return queryOne<StaffUserRow>(
    `SELECT ${STAFF_COLUMNS} FROM staff_users WHERE id = $1`,
    [id],
  );
}

export async function getStaffByEmail(
  email: string,
): Promise<StaffUserRow | undefined> {
  return queryOne<StaffUserRow>(
    `SELECT ${STAFF_COLUMNS} FROM staff_users WHERE email = $1`,
    [email],
  );
}
