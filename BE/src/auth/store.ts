import { createHash, randomBytes, randomInt } from "node:crypto";
import { getDummyHash, hashPassword, verifyPassword } from "./password.js";
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
  /** §8 decision 14: ADMIN-set password, or older than the expiry period. */
  password_change_required?: boolean;
};

/**
 * §8 decision 14 (c): a password must be replaced once it is older than
 * security_settings.password_max_age_days, or when ADMIN set it.
 */
const PASSWORD_CHANGE_REQUIRED_SQL = `(must_change_password OR (password_changed_at IS NULL
     OR password_changed_at < now() - (SELECT password_max_age_days FROM security_settings) * INTERVAL '1 day'))`;

export async function getCredentialsByEmail(
  email: string,
): Promise<CredentialRow | undefined> {
  return queryOne<CredentialRow>(
    `SELECT id, email, full_name, role, is_active, password_hash,
            failed_login_count, locked_until,
            ${PASSWORD_CHANGE_REQUIRED_SQL} AS password_change_required
       FROM staff_users
      WHERE lower(email) = lower($1)`,
    [email],
  );
}

/**
 * Counts a failure and, at the threshold, blocks the account — §8 decision 14
 * (d): until ADMIN unlocks it or the owner resets the password through "Lupa
 * kata laluan" (locked_until = infinity), not for a fixed time. Done in one
 * UPDATE so concurrent guesses can't each read a stale count and slip past it.
 */
export async function recordFailedLogin(
  staffId: string,
  maxAttempts: number,
): Promise<void> {
  await query(
    `UPDATE staff_users
        SET failed_login_count = failed_login_count + 1,
            locked_until = CASE
              WHEN failed_login_count + 1 >= $2 THEN 'infinity'::timestamptz
              ELSE locked_until
            END
      WHERE id = $1`,
    [staffId, maxAttempts],
  );
}

/** ADMIN: lifts a block and resets the failure count. */
export async function unlockStaffAccount(
  id: string,
): Promise<StaffAccountRow | undefined> {
  return queryOne<StaffAccountRow>(
    `UPDATE staff_users SET failed_login_count = 0, locked_until = NULL
      WHERE id = $1 RETURNING ${ACCOUNT_COLUMNS}`,
    [id],
  );
}

// ─── Security settings — §8 decision 14 (c) ─────────────────────────────────

export type SecuritySettingsRow = {
  password_max_age_days: number;
  updated_at: Date;
  updated_by_name: string | null;
};

export async function getSecuritySettings(): Promise<SecuritySettingsRow> {
  const row = await queryOne<SecuritySettingsRow>(
    `SELECT s.password_max_age_days, s.updated_at, u.full_name AS updated_by_name
       FROM security_settings s
       LEFT JOIN staff_users u ON u.id = s.updated_by`,
  );
  if (!row) throw new Error("security_settings kosong");
  return row;
}

export async function updateSecuritySettings(
  passwordMaxAgeDays: number,
  staffId: string,
): Promise<SecuritySettingsRow> {
  await query(
    `UPDATE security_settings
        SET password_max_age_days = $1, updated_by = $2, updated_at = now()`,
    [passwordMaxAgeDays, staffId],
  );
  return getSecuritySettings();
}

// ─── Sign-in challenges — §8 decision 14 (a), (c), (l) ──────────────────────

export type AuthChallengePurpose =
  "LOGIN_MFA" | "PASSWORD_CHANGE" | "PASSWORD_RESET";

export const STAFF_CODE_DIGITS = 6;
const CODE_MAX_ATTEMPTS = 5;

/**
 * Starts a sign-in step. With `withCode`, a 6-digit code is generated, stored
 * as a scrypt hash, and returned so the caller can email it. `staffId` may be
 * null for "Lupa kata laluan" on an unknown email: the caller still gets a
 * token that looks the same, and no code can ever satisfy it.
 */
export async function createAuthChallenge(input: {
  staffId: string | null;
  purpose: AuthChallengePurpose;
  ttlMinutes: number;
  withCode: boolean;
}): Promise<{ token: string; code: string | null }> {
  const token = randomBytes(32).toString("base64url");
  const code = input.withCode
    ? String(randomInt(0, 10 ** STAFF_CODE_DIGITS)).padStart(
        STAFF_CODE_DIGITS,
        "0",
      )
    : null;
  // Hash even when there's no one to send it to, so both cost the same.
  const codeHash = input.withCode ? await hashPassword(code ?? "") : null;

  await withTransaction(async (client) => {
    if (input.staffId) {
      // A new challenge supersedes older ones of the same kind.
      await client.query(
        `UPDATE staff_auth_challenges SET consumed_at = now()
          WHERE staff_id = $1 AND purpose = $2 AND consumed_at IS NULL`,
        [input.staffId, input.purpose],
      );
    }
    await client.query(
      `INSERT INTO staff_auth_challenges (id, staff_id, purpose, code_hash, expires_at)
       VALUES ($1, $2, $3, $4, now() + ($5::int * INTERVAL '1 minute'))`,
      [
        hashToken(token),
        input.staffId,
        input.purpose,
        input.staffId ? codeHash : null,
        input.ttlMinutes,
      ],
    );
    await client.query(
      `DELETE FROM staff_auth_challenges WHERE created_at < now() - INTERVAL '1 day'`,
    );
  });
  return { token, code: input.staffId ? code : null };
}

/**
 * Checks a code against a challenge; success consumes it and returns the
 * staff id. A wrong code counts; at the limit even the right code is refused.
 * Always pays for one scrypt.
 */
export async function verifyAuthChallengeCode(
  token: string,
  purpose: AuthChallengePurpose,
  code: string,
  /** false: leave it usable, to be spent with consumeAuthChallenge afterwards. */
  consume = true,
): Promise<string | null> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<{
      staff_id: string | null;
      code_hash: string | null;
      usable: boolean;
    }>(
      `SELECT staff_id, code_hash,
              (consumed_at IS NULL AND expires_at > now() AND attempt_count < $3) AS usable
         FROM staff_auth_challenges
        WHERE id = $1 AND purpose = $2
        FOR UPDATE`,
      [hashToken(token), purpose, CODE_MAX_ATTEMPTS],
    );
    const row = rows[0];
    const matches = await verifyPassword(
      code,
      row?.code_hash ?? (await getDummyHash()),
    );
    if (!row || !row.usable || !row.staff_id || !row.code_hash) return null;

    if (!matches) {
      await client.query(
        `UPDATE staff_auth_challenges SET attempt_count = attempt_count + 1 WHERE id = $1`,
        [hashToken(token)],
      );
      return null;
    }
    if (consume) {
      await client.query(
        `UPDATE staff_auth_challenges SET consumed_at = now() WHERE id = $1`,
        [hashToken(token)],
      );
    }
    return row.staff_id;
  });
}

/**
 * The staff id behind a live challenge, without spending it. Only for a token
 * that is itself proof (PASSWORD_CHANGE is issued after password + code).
 */
export async function peekAuthChallengeStaff(
  token: string,
  purpose: AuthChallengePurpose,
): Promise<string | null> {
  const row = await queryOne<{ staff_id: string }>(
    `SELECT staff_id FROM staff_auth_challenges
      WHERE id = $1 AND purpose = $2 AND consumed_at IS NULL
        AND expires_at > now() AND staff_id IS NOT NULL`,
    [hashToken(token), purpose],
  );
  return row?.staff_id ?? null;
}

/** Spends a challenge; returns its staff id, or null if it was already spent. */
export async function consumeAuthChallenge(
  token: string,
  purpose: AuthChallengePurpose,
): Promise<string | null> {
  const row = await queryOne<{ staff_id: string }>(
    `UPDATE staff_auth_challenges SET consumed_at = now()
      WHERE id = $1 AND purpose = $2 AND consumed_at IS NULL
        AND expires_at > now() AND staff_id IS NOT NULL
      RETURNING staff_id`,
    [hashToken(token), purpose],
  );
  return row?.staff_id ?? null;
}

/** For the sign-in steps after the password: current state of the account. */
export async function getCredentialsById(
  staffId: string,
): Promise<CredentialRow | undefined> {
  return queryOne<CredentialRow>(
    `SELECT id, email, full_name, role, is_active, password_hash,
            failed_login_count, locked_until,
            ${PASSWORD_CHANGE_REQUIRED_SQL} AS password_change_required
       FROM staff_users
      WHERE id = $1`,
    [staffId],
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
  /** §8 decision 14 (c): true when ADMIN sets it — the owner must replace it. */
  mustChange = false,
): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE staff_users
          SET password_hash = $2, password_changed_at = now(),
              failed_login_count = 0, locked_until = NULL,
              must_change_password = $3
        WHERE id = $1`,
      [staffId, passwordHash, mustChange],
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
  must_change_password: boolean;
  password_expired: boolean;
  last_login_at: Date | null;
  password_changed_at: Date | null;
  created_at: Date;
};

const ACCOUNT_COLUMNS = `
  id, email, full_name, role, is_active,
  password_hash IS NOT NULL AS has_password,
  COALESCE(locked_until > now(), FALSE) AS locked,
  must_change_password,
  (password_changed_at IS NULL
     OR password_changed_at < now() - (SELECT password_max_age_days FROM security_settings) * INTERVAL '1 day') AS password_expired,
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
  /** ADMIN-created accounts: the owner replaces the password at first login. */
  mustChangePassword?: boolean;
}): Promise<StaffAccountRow> {
  try {
    const row = await queryOne<StaffAccountRow>(
      `INSERT INTO staff_users (full_name, role, email, password_hash, password_changed_at, must_change_password)
       VALUES ($1, $2, $3, $4, now(), $5)
       RETURNING ${ACCOUNT_COLUMNS}`,
      [
        input.fullName,
        input.role,
        input.email,
        input.passwordHash,
        input.mustChangePassword ?? false,
      ],
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

/** §8 decision 13: first-run setup is open only while this is true. */
export async function hasNoStaffAccounts(): Promise<boolean> {
  const row = await queryOne<{ empty: boolean }>(
    `SELECT NOT EXISTS (SELECT 1 FROM staff_users) AS empty`,
  );
  return row?.empty ?? false;
}

/**
 * First-run setup (§8 decision 13): creates the first ADMIN, and only while no
 * staff account exists at all. The check and the insert share an advisory
 * lock, so two simultaneous setups can't both succeed; afterwards every
 * account is created by an ADMIN (or the CLI).
 */
export async function createFirstAdmin(input: {
  email: string;
  fullName: string;
  passwordHash: string;
}): Promise<CredentialRow> {
  try {
    return await withTransaction(async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('staff:first-run-setup'))",
      );
      const existing = await client.query(`SELECT 1 FROM staff_users LIMIT 1`);
      if (existing.rowCount) {
        throw new DomainError(
          409,
          "Persediaan awal telah selesai. Log masuk, atau minta ADMIN mencipta akaun anda.",
        );
      }
      const inserted = await client.query<CredentialRow>(
        `INSERT INTO staff_users (full_name, role, email, password_hash, password_changed_at)
         VALUES ($1, 'ADMIN', $2, $3, now())
         RETURNING id, email, full_name, role, is_active, password_hash,
                   failed_login_count, locked_until`,
        [input.fullName, input.email, input.passwordHash],
      );
      const row = inserted.rows[0];
      if (!row) throw new Error("Gagal mencipta akaun ADMIN");
      return row;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new DomainError(409, "E-mel ini sudah digunakan oleh akaun lain");
    }
    throw err;
  }
}
