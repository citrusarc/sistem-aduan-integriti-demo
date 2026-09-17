import { query, queryOne } from "../client.js";
import { REFERRAL_RECIPIENT_ROLES } from "../../auth/roles.js";
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

/**
 * KJ / SUB_UNIT accounts, for the Integrity Unit's "refer this action" picker
 * (§8 decision 5). Inactive ones are included so an existing referral can still
 * be named; only active ones are accepted as a new assignee.
 */
export async function listReferralRecipients(): Promise<StaffUserRow[]> {
  const result = await query<StaffUserRow>(
    `SELECT ${STAFF_COLUMNS}
       FROM staff_users
      WHERE role = ANY($1::staff_role_enum[])
      ORDER BY is_active DESC, full_name`,
    [REFERRAL_RECIPIENT_ROLES],
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
