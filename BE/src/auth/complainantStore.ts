import { createHash, randomBytes, randomInt } from "node:crypto";
import { query, queryOne, withTransaction } from "../db/client.js";
import { PUBLICLY_DISCLOSABLE_SQL } from "../db/queries/complaints.js";
import { getDummyHash, hashPassword, verifyPassword } from "./password.js";

/**
 * Complainant login by EMAIL OTP — CLAUDE.md §8 decision 4. The only module
 * that reads `complainant_otp_codes` or `complainant_sessions`.
 *
 * Deliberately separate from staff auth: its own tables, its own cookie
 * (`aduan_csid`), and a session that identifies an email address, never a
 * staff member. Codes travel only by email (rule 10).
 *
 * Codes are stored as scrypt hashes, not SHA-256: a 6-digit code has only a
 * million possibilities, so a fast hash of one would be reversed instantly
 * from a leaked table. scrypt makes that cost hours per code, and a code lives
 * ten minutes.
 */

export type OtpPolicy = {
  digits: number;
  ttlMinutes: number;
  maxAttempts: number;
  cooldownSeconds: number;
  maxPerHour: number;
};

/**
 * Whether an address may receive a login code: it must be the contact email of
 * at least one complaint the complainant is allowed to see (rule 2). Anyone
 * else gets the same response and no email — the portal can't be used to mail
 * codes to arbitrary addresses, or to learn which addresses have complaints.
 */
async function hasDisclosableComplaint(email: string): Promise<boolean> {
  const row = await queryOne<{ found: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM complaints c
        WHERE c.complainant_id IN (
                SELECT id FROM complainants WHERE lower(contact_email) = $1
              )
          AND ${PUBLICLY_DISCLOSABLE_SQL}
     ) AS found`,
    [email],
  );
  return row?.found ?? false;
}

export type IssueResult =
  | { issued: true; code: string }
  | { issued: false; reason: "no-complaints" | "throttled" };

/**
 * Issues a new code for `email`, unless the address has no visible complaints
 * or has had a code too recently. Issuing supersedes every earlier code: only
 * the newest row for an address is ever accepted.
 *
 * Callers must answer identically whatever the result.
 */
export async function issueOtp(
  email: string,
  policy: OtpPolicy,
  ip: string | undefined,
): Promise<IssueResult> {
  // Hash before looking the address up, so an unknown address costs the same
  // scrypt as a known one and response time doesn't tell them apart.
  const code = String(randomInt(0, 10 ** policy.digits)).padStart(
    policy.digits,
    "0",
  );
  const codeHash = await hashPassword(code);

  if (!(await hasDisclosableComplaint(email))) {
    return { issued: false, reason: "no-complaints" };
  }

  return withTransaction(async (client) => {
    // Serialise concurrent requests for one address so the throttle holds.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `otp:${email}`,
    ]);

    const recent = await client.query<{ last_seconds: number; hour: number }>(
      `SELECT COALESCE(extract(epoch FROM now() - max(created_at)), 1e9)::float8 AS last_seconds,
              count(*) FILTER (WHERE created_at > now() - INTERVAL '1 hour')::int AS hour
         FROM complainant_otp_codes
        WHERE email = $1`,
      [email],
    );
    const { last_seconds, hour } = recent.rows[0] ?? {
      last_seconds: 1e9,
      hour: 0,
    };
    if (last_seconds < policy.cooldownSeconds || hour >= policy.maxPerHour) {
      return { issued: false, reason: "throttled" } as const;
    }

    await client.query(
      `INSERT INTO complainant_otp_codes (email, code_hash, expires_at, ip)
       VALUES ($1, $2, now() + ($3::int * INTERVAL '1 minute'), $4)`,
      [email, codeHash, policy.ttlMinutes, ip ?? null],
    );
    // Opportunistic cleanup of long-dead codes.
    await client.query(
      `DELETE FROM complainant_otp_codes WHERE created_at < now() - INTERVAL '1 day'`,
    );

    return { issued: true, code } as const;
  });
}

/**
 * Checks `code` against the newest code for `email`. Succeeds only when that
 * code is unused, unexpired, and under the attempt limit; success consumes it,
 * so it can't be replayed. A wrong guess counts toward the limit, and at the
 * limit even the right code is refused.
 *
 * Always pays for one scrypt, so an address with no code answers as slowly as
 * a wrong guess.
 */
export async function verifyOtp(
  email: string,
  code: string,
  policy: OtpPolicy,
): Promise<boolean> {
  return withTransaction(async (client) => {
    const result = await client.query<{
      id: string;
      code_hash: string;
      usable: boolean;
    }>(
      `SELECT id, code_hash,
              (consumed_at IS NULL AND expires_at > now() AND attempt_count < $2) AS usable
         FROM complainant_otp_codes
        WHERE email = $1
        ORDER BY created_at DESC, id DESC
        LIMIT 1
        FOR UPDATE`,
      [email, policy.maxAttempts],
    );
    const row = result.rows[0];

    const matches = await verifyPassword(
      code,
      row?.code_hash ?? (await getDummyHash()),
    );

    if (!row || !row.usable) return false;

    if (!matches) {
      await client.query(
        `UPDATE complainant_otp_codes
            SET attempt_count = attempt_count + 1
          WHERE id = $1`,
        [row.id],
      );
      return false;
    }

    await client.query(
      `UPDATE complainant_otp_codes SET consumed_at = now() WHERE id = $1`,
      [row.id],
    );
    return true;
  });
}

/** The raw token goes to the cookie; only its SHA-256 is stored. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createComplainantSession(input: {
  email: string;
  ttlMinutes: number;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");

  const row = await queryOne<{ expires_at: Date }>(
    `INSERT INTO complainant_sessions (id, email, expires_at, ip, user_agent)
     VALUES ($1, $2, now() + ($3::int * INTERVAL '1 minute'), $4, $5)
     RETURNING expires_at`,
    [
      hashToken(token),
      input.email,
      input.ttlMinutes,
      input.ip ?? null,
      input.userAgent?.slice(0, 512) ?? null,
    ],
  );
  if (!row) throw new Error("Gagal mencipta sesi");

  await query(`DELETE FROM complainant_sessions WHERE expires_at < now()`);
  return { token, expiresAt: row.expires_at };
}

export type AuthenticatedComplainant = {
  email: string;
  sessionExpiresAt: Date;
};

/** Absolute expiry and idle timeout checked on every request; a hit slides last_seen_at. */
export async function resolveComplainantSession(
  token: string,
  idleTimeoutMinutes: number,
): Promise<AuthenticatedComplainant | undefined> {
  const row = await queryOne<{ email: string; expires_at: Date }>(
    `UPDATE complainant_sessions
        SET last_seen_at = now()
      WHERE id = $1
        AND expires_at > now()
        AND last_seen_at > now() - ($2::int * INTERVAL '1 minute')
      RETURNING email, expires_at`,
    [hashToken(token), idleTimeoutMinutes],
  );
  return row && { email: row.email, sessionExpiresAt: row.expires_at };
}

export async function deleteComplainantSession(token: string): Promise<void> {
  await query(`DELETE FROM complainant_sessions WHERE id = $1`, [
    hashToken(token),
  ]);
}
