import { createHash, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { query, queryOne, withTransaction } from "../db/client.js";
import { DomainError, isUniqueViolation } from "../db/errors.js";
import type { StaffRole } from "../types/enums.js";

/**
 * Credential and session queries. The only module that reads `password_hash`
 * or `staff_sessions` — general staff queries in db/queries/staffUsers.ts never
 * select them, so a hash cannot ride along into an API response.
 */

export type AuthenticatedStaff = {
  id: string;
  email: string;
  fullName: string;
  role: StaffRole;
};

type CredentialRow = {
  id: string;
  email: string;
  full_name: string;
  role: StaffRole;
  is_active: boolean;
  password_hash: string | null;
  failed_login_count: number;
  locked_until: Date | null;
};

export async function getCredentialsByEmail(
  email: string,
): Promise<CredentialRow | undefined> {
  return queryOne<CredentialRow>(
    `SELECT id, email, full_name, role, is_active, password_hash,
            failed_login_count, locked_until
       FROM staff_users
      WHERE lower(email) = lower($1)`,
    [email],
  );
}

/**
 * Counts a failure and, at the threshold, locks the account. Done in one
 * UPDATE so concurrent guesses can't each read a stale count and slip past it.
 */
export async function recordFailedLogin(
  staffId: string,
  maxAttempts: number,
  lockoutMinutes: number,
): Promise<void> {
  await query(
    `UPDATE staff_users
        SET failed_login_count = failed_login_count + 1,
            locked_until = CASE
              WHEN failed_login_count + 1 >= $2
              THEN now() + ($3::int * INTERVAL '1 minute')
              ELSE locked_until
            END
      WHERE id = $1`,
    [staffId, maxAttempts, lockoutMinutes],
  );
}

export async function recordSuccessfulLogin(staffId: string): Promise<void> {
  await query(
    `UPDATE staff_users
        SET failed_login_count = 0, locked_until = NULL, last_login_at = now()
      WHERE id = $1`,
    [staffId],
  );
}

/** The raw token goes to the cookie; only its SHA-256 is ever stored. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(input: {
  staffId: string;
  ttlMinutes: number;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");

  const row = await queryOne<{ expires_at: Date }>(
    `INSERT INTO staff_sessions (id, staff_id, expires_at, ip, user_agent)
     VALUES ($1, $2, now() + ($3::int * INTERVAL '1 minute'), $4, $5)
     RETURNING expires_at`,
    [
      hashToken(token),
      input.staffId,
      input.ttlMinutes,
      input.ip ?? null,
      input.userAgent?.slice(0, 512) ?? null,
    ],
  );

  if (!row) throw new Error("Gagal mencipta sesi");

  // Opportunistic cleanup; not worth a cron job at this volume.
  await query(`DELETE FROM staff_sessions WHERE expires_at < now()`);

  return { token, expiresAt: row.expires_at };
}

/**
 * Resolves a cookie token to a staff member, or undefined.
 *
 * Checked on EVERY request, in one statement:
 *   - session exists and is within its absolute expiry
 *   - session has been used within the idle timeout
 *   - staff member is still active (deactivation takes effect immediately)
 *
 * A valid hit slides `last_seen_at` forward.
 */
export async function resolveSession(
  token: string,
  idleTimeoutMinutes: number,
): Promise<AuthenticatedStaff | undefined> {
  const row = await queryOne<{
    id: string;
    email: string;
    full_name: string;
    role: StaffRole;
  }>(
    `UPDATE staff_sessions s
        SET last_seen_at = now()
       FROM staff_users u
      WHERE s.id = $1
        AND u.id = s.staff_id
        AND u.is_active
        AND s.expires_at > now()
        AND s.last_seen_at > now() - ($2::int * INTERVAL '1 minute')
      RETURNING u.id, u.email, u.full_name, u.role`,
    [hashToken(token), idleTimeoutMinutes],
  );

  if (!row) return undefined;
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
  };
}

export async function deleteSession(token: string): Promise<void> {
  await query(`DELETE FROM staff_sessions WHERE id = $1`, [hashToken(token)]);
}

export async function deleteAllSessionsForStaff(
  staffId: string,
): Promise<void> {
  await query(`DELETE FROM staff_sessions WHERE staff_id = $1`, [staffId]);
}

/**
 * Sets a new password and signs the staff member out everywhere, atomically.
 * `keepToken`, when given, preserves the session making the change so the
 * person isn't logged out of the tab they just used.
 */
export async function setPassword(
  staffId: string,
  passwordHash: string,
  keepToken?: string,
): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE staff_users
          SET password_hash = $2, password_changed_at = now(),
              failed_login_count = 0, locked_until = NULL
        WHERE id = $1`,
      [staffId, passwordHash],
    );
    await client.query(
      `DELETE FROM staff_sessions WHERE staff_id = $1 AND id <> $2`,
      [staffId, keepToken ? hashToken(keepToken) : ""],
    );
  });
}

// ─── Account management — §8 decision 7 ─────────────────────────────────────
// Used by both the ADMIN endpoints (routes/staff.admin.ts) and the CLI
// (scripts/staff.ts), so the two can't drift apart.

/** What an account listing may show. `hasPassword`, never the hash. */
export type StaffAccountRow = {
  id: string;
  email: string | null;
  full_name: string;
  role: StaffRole;
  is_active: boolean;
  has_password: boolean;
  locked: boolean;
  last_login_at: Date | null;
  password_changed_at: Date | null;
  created_at: Date;
};

const ACCOUNT_COLUMNS = `
  id, email, full_name, role, is_active,
  password_hash IS NOT NULL AS has_password,
  COALESCE(locked_until > now(), FALSE) AS locked,
  last_login_at, password_changed_at, created_at
`;

export async function listStaffAccounts(): Promise<StaffAccountRow[]> {
  const result = await query<StaffAccountRow>(
    `SELECT ${ACCOUNT_COLUMNS} FROM staff_users ORDER BY role, full_name, id`,
  );
  return result.rows;
}

export async function getStaffAccount(
  id: string,
): Promise<StaffAccountRow | undefined> {
  return queryOne<StaffAccountRow>(
    `SELECT ${ACCOUNT_COLUMNS} FROM staff_users WHERE id = $1`,
    [id],
  );
}

export async function findStaffIdByEmail(
  email: string,
): Promise<string | undefined> {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM staff_users WHERE lower(email) = lower($1)`,
    [email],
  );
  return row?.id;
}

/** `passwordHash` from hashPassword(), after checkPasswordPolicy(). 409 on a taken email. */
export async function createStaffAccount(input: {
  email: string;
  fullName: string;
  role: StaffRole;
  passwordHash: string;
}): Promise<StaffAccountRow> {
  try {
    const row = await queryOne<StaffAccountRow>(
      `INSERT INTO staff_users (full_name, role, email, password_hash, password_changed_at)
       VALUES ($1, $2, $3, $4, now())
       RETURNING ${ACCOUNT_COLUMNS}`,
      [input.fullName, input.role, input.email, input.passwordHash],
    );
    if (!row) throw new Error("Gagal mencipta akaun staf");
    return row;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new DomainError(409, "E-mel ini sudah digunakan oleh akaun lain");
    }
    throw err;
  }
}

/**
 * Locks the account row plus every active ADMIN row, then refuses a change
 * that would leave no active ADMIN — nobody could manage accounts afterwards
 * except through the CLI. Locking the ADMIN rows stops two concurrent changes
 * each seeing "one other admin remains".
 */
async function lockForAdminGuard(
  client: PoolClient,
  id: string,
  change: (current: { role: StaffRole; is_active: boolean }) => {
    role: StaffRole;
    isActive: boolean;
  },
): Promise<void> {
  const target = await client.query<{ role: StaffRole; is_active: boolean }>(
    `SELECT role, is_active FROM staff_users WHERE id = $1 FOR UPDATE`,
    [id],
  );
  const current = target.rows[0];
  if (!current) throw new DomainError(404, "Akaun staf tidak dijumpai");
  const after = change(current);

  // Only a change that takes away an active ADMIN can empty the ADMIN set.
  const wasActiveAdmin = current.role === "ADMIN" && current.is_active;
  const staysActiveAdmin = after.role === "ADMIN" && after.isActive;
  if (!wasActiveAdmin || staysActiveAdmin) return;

  const admins = await client.query<{ id: string }>(
    `SELECT id FROM staff_users WHERE role = 'ADMIN' AND is_active FOR UPDATE`,
  );
  if (admins.rows.every((r) => r.id === id)) {
    throw new DomainError(
      409,
      "Perubahan ini akan meninggalkan sistem tanpa ADMIN yang aktif",
    );
  }
}

/**
 * A role change takes effect on the account's very next request: every
 * request re-reads the role through resolveSession(), so there is no stale
 * permission to revoke.
 */
export async function setStaffRole(
  id: string,
  role: StaffRole,
): Promise<StaffAccountRow> {
  return withTransaction(async (client) => {
    await lockForAdminGuard(client, id, (current) => ({
      role,
      isActive: current.is_active,
    }));

    const result = await client.query<StaffAccountRow>(
      `UPDATE staff_users SET role = $2 WHERE id = $1 RETURNING ${ACCOUNT_COLUMNS}`,
      [id, role],
    );
    return result.rows[0]!;
  });
}

/**
 * Deactivating deletes every session in the same transaction, so the person is
 * signed out at once; resolveSession() also refuses inactive accounts on every
 * request, so there's no window either way.
 */
export async function setStaffActive(
  id: string,
  isActive: boolean,
): Promise<StaffAccountRow> {
  return withTransaction(async (client) => {
    await lockForAdminGuard(client, id, (current) => ({
      role: current.role,
      isActive,
    }));

    const result = await client.query<StaffAccountRow>(
      `UPDATE staff_users SET is_active = $2 WHERE id = $1 RETURNING ${ACCOUNT_COLUMNS}`,
      [id, isActive],
    );
    if (!isActive) {
      await client.query(`DELETE FROM staff_sessions WHERE staff_id = $1`, [
        id,
      ]);
    }
    return result.rows[0]!;
  });
}
