// Load BE/.env when present. Real environment variables win over the file, so
// production can set everything in the process environment and ship no .env.
try {
  process.loadEnvFile(".env");
} catch (err) {
  if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Pemboleh ubah persekitaran ${name} tidak ditetapkan`);
  }
  return value;
}

const isProduction = process.env.NODE_ENV === "production";

export const config = {
  isProduction,
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required("DATABASE_URL"),
  dbPoolMax: Number(process.env.DB_POOL_MAX ?? 10),
  corsOrigins: (process.env.CORS_ORIGIN ?? "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),

  auth: {
    cookieName: "aduan_sid",
    /** Hard cap on a session regardless of activity — one working day. */
    sessionTtlMinutes: Number(process.env.SESSION_TTL_MINUTES ?? 8 * 60),
    /** Signed out after this long without a request. */
    idleTimeoutMinutes: Number(process.env.SESSION_IDLE_MINUTES ?? 30),
    maxFailedLogins: Number(process.env.AUTH_MAX_FAILED_LOGINS ?? 5),
    lockoutMinutes: Number(process.env.AUTH_LOCKOUT_MINUTES ?? 15),
    /**
     * SameSite=Lax works when FE and BE share a registrable domain (true for
     * localhost:3000 -> localhost:4000, and for app.x.gov.my -> api.x.gov.my).
     * Hosting them on unrelated domains needs "none", which also requires
     * HTTPS — and makes the Origin check in middleware/auth.ts the only CSRF
     * defence, so keep CORS_ORIGIN tight.
     */
    cookieSameSite: (process.env.COOKIE_SAMESITE ?? "lax") as
      "lax" | "strict" | "none",
    cookieSecure: isProduction || process.env.COOKIE_SAMESITE === "none",
  },

  /**
   * Complainant login by email OTP — CLAUDE.md §8 decision 4. The code shape,
   * expiry, and attempt limit are the decision itself, so they are constants,
   * not environment settings (and the attempt limit is also a DB check).
   */
  complainantAuth: {
    cookieName: "aduan_csid",
    otpDigits: 6,
    otpTtlMinutes: 10,
    otpMaxAttempts: 5,
    /** Minimum gap between codes sent to one address. */
    otpCooldownSeconds: Number(process.env.OTP_COOLDOWN_SECONDS ?? 60),
    /** Codes sent to one address per rolling hour. */
    otpMaxPerHour: Number(process.env.OTP_MAX_PER_HOUR ?? 5),
    sessionTtlMinutes: Number(
      process.env.COMPLAINANT_SESSION_TTL_MINUTES ?? 120,
    ),
    idleTimeoutMinutes: Number(
      process.env.COMPLAINANT_SESSION_IDLE_MINUTES ?? 30,
    ),
  },
};
