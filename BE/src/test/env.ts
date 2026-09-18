/**
 * Import this FIRST in any test that touches the database. It points
 * DATABASE_URL at the test database before `src/config.ts` reads it — ES
 * modules evaluate imports in order, so a later import of the app sees it.
 *
 * The test database comes from TEST_DATABASE_URL, or else DATABASE_URL with
 * `_test` appended to the database name. Tests DROP and recreate it, so the
 * name must end in `_test` and it must be local; anything else is refused.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assertResettable } from "../db/migrate.js";

try {
  process.loadEnvFile(".env");
} catch (err) {
  if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
}

function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;

  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error(
      "Tetapkan TEST_DATABASE_URL (atau DATABASE_URL) untuk menjalankan ujian",
    );
  }
  const url = new URL(base);
  url.pathname = `${url.pathname}_test`;
  return url.toString();
}

export const TEST_DATABASE_URL = testDatabaseUrl();

const dbName = decodeURIComponent(new URL(TEST_DATABASE_URL).pathname.slice(1));
if (!dbName.endsWith("_test")) {
  throw new Error(
    `Ujian memadam pangkalan data; nama mesti berakhir dengan _test (diberi: ${dbName})`,
  );
}
assertResettable(TEST_DATABASE_URL);

process.env.DATABASE_URL = TEST_DATABASE_URL;
// Uploaded test files go to a throwaway directory, never the real UPLOAD_DIR.
process.env.UPLOAD_DIR = mkdtempSync(
  path.join(tmpdir(), "aduan-uploads-test-"),
);
// Lets the harness capture outbound email instead of printing it.
process.env.NODE_ENV = "test";
// Tests register many complainants and submit many complaints from 127.0.0.1;
// the anti-spam limits (§8 decision 16) are exercised by their own tests,
// which set config.portal directly.
process.env.PORTAL_SUBMISSIONS_PER_IP_PER_HOUR = "0";
process.env.PORTAL_ACK_EMAILS_PER_DAY = "1000";
// No automatic first ADMIN unless a test asks for one (sets config directly).
process.env.INITIAL_ADMIN_EMAIL = "";
