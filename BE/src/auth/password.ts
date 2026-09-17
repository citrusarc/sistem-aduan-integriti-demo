import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";

/**
 * scrypt via node:crypto — memory-hard, and no native addon to compile, unlike
 * bcrypt or argon2 bindings.
 *
 * Stored format is self-describing so parameters can be raised later without
 * invalidating existing hashes:
 *
 *   scrypt$<N>$<r>$<p>$<salt base64>$<hash base64>
 */

const KEY_LENGTH = 64;
const SALT_BYTES = 16;

// N=2^15, r=8 -> ~32 MiB per hash, ~50-100 ms on a modern core. Deliberately
// slow; login is rare and this is what makes a stolen table expensive to crack.
const PARAMS = { N: 2 ** 15, r: 8, p: 1 } as const;

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 256;

function scrypt(
  password: string,
  salt: Buffer,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password.normalize("NFKC"),
      salt,
      KEY_LENGTH,
      // maxmem must exceed 128 * N * r, or scrypt refuses to run.
      { ...options, maxmem: 128 * (options.N ?? 0) * (options.r ?? 0) * 2 },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scrypt(password, salt, PARAMS);
  return [
    "scrypt",
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString("base64"),
    key.toString("base64"),
  ].join("$");
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64 ?? "", "base64");
  if (expected.length !== KEY_LENGTH) return false;

  const actual = await scrypt(password, Buffer.from(saltB64 ?? "", "base64"), {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });

  return timingSafeEqual(actual, expected);
}

/**
 * A real hash of a random password, computed once at startup. When login is
 * attempted for an email that doesn't exist, we still verify against this so
 * the response takes as long as a wrong password would. Otherwise response
 * time alone reveals which emails belong to staff.
 */
let dummyHash: Promise<string> | undefined;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(32).toString("hex"));
  return dummyHash;
}

/**
 * §8 decision 14 (b): every password — including one ADMIN sets for someone
 * else, and the first ADMIN's — has all four character categories. FE mirrors
 * these rules in lib/auth.ts for its checklist; this is the enforcement.
 */
export const PASSWORD_RULES = [
  { test: (p: string) => /[A-Z]/.test(p), message: "huruf besar (A-Z)" },
  { test: (p: string) => /[a-z]/.test(p), message: "huruf kecil (a-z)" },
  { test: (p: string) => /[0-9]/.test(p), message: "nombor (0-9)" },
  {
    test: (p: string) => /[^A-Za-z0-9\s]/.test(p),
    message: "aksara khas (contohnya @ # $ % ^ &)",
  },
] as const;

/** Returns an error message, or null when the password is acceptable. */
export function checkPasswordPolicy(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Kata laluan mesti sekurang-kurangnya ${MIN_PASSWORD_LENGTH} aksara`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Kata laluan tidak boleh melebihi ${MAX_PASSWORD_LENGTH} aksara`;
  }
  const missing = PASSWORD_RULES.filter((rule) => !rule.test(password)).map(
    (rule) => rule.message,
  );
  if (missing.length) {
    return `Kata laluan mesti mengandungi ${missing.join(", ")}`;
  }
  return null;
}
