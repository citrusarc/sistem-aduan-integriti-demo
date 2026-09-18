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

  /**
   * Supporting documents (§8 decision 10). Stored on this machine's disk —
   * there is no cloud storage. The directory holds evidence: back it up, and
   * never serve it statically.
   */
  uploads: {
    dir: process.env.UPLOAD_DIR ?? "uploads",
    maxFileBytes: Number(process.env.UPLOAD_MAX_FILE_MB ?? 10) * 1024 * 1024,
    /** Per request, for the portal submission and a staff upload alike. */
    maxFilesPerRequest: 5,
    /** Across a complaint's lifetime. */
    maxFilesPerComplaint: 20,
  },

  auth: {
    cookieName: "aduan_sid",
    /** Hard cap on a session regardless of activity — one working day. */
    sessionTtlMinutes: Number(process.env.SESSION_TTL_MINUTES ?? 8 * 60),
    /** Signed out after this long without a request. */
    idleTimeoutMinutes: Number(process.env.SESSION_IDLE_MINUTES ?? 30),
    /**
     * §8 decision 14 (d): wrong passwords before the account is blocked — until
     * ADMIN unlocks it or the owner resets it. Five, per the policy.
     */
    maxFailedLogins: 5,
    /** Email code (MFA, password reset) and password-change token lifetime. */
    codeTtlMinutes: 10,
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
   * §8 decision 15: the address that becomes the first ADMIN when it proves
   * itself (registration or login code) while no active ADMIN exists. Unset:
   * the first ADMIN comes from `npm run staff -- create`.
   */
  initialAdminEmail: process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase() || null,

  /** §8 decision 16 — keeping portal submissions from being used to spam. */
  portal: {
    /**
     * Portal submissions per client IP per rolling hour; 0 turns it off. Kept
     * in memory only — an anonymous complainant's IP is never stored.
     */
    submissionsPerIpPerHour: Number(
      process.env.PORTAL_SUBMISSIONS_PER_IP_PER_HOUR ?? 10,
    ),
    /**
     * Acknowledgement emails one address receives per rolling 24 hours. The
     * complaint is still registered beyond this; it just isn't emailed about.
     */
    ackEmailsPerAddressPerDay: Number(
      process.env.PORTAL_ACK_EMAILS_PER_DAY ?? 3,
    ),
  },
};
