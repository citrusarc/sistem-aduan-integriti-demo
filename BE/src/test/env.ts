/**
 * Import this FIRST in any test that touches the database. It points
 * DATABASE_URL at the test database before `src/config.ts` reads it — ES
 * modules evaluate imports in order, so a later import of the app sees it.
 *
 * The test database comes from TEST_DATABASE_URL, or else DATABASE_URL with
 * `_test` appended to the database name. Tests DROP and recreate it, so the
 * name must end in `_test` and it must be local; anything else is refused.
 */
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
// Lets the harness capture outbound email instead of printing it.
process.env.NODE_ENV = "test";
