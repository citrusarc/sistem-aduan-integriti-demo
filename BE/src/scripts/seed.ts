/**
 * Local demo data: `npm run db:reset && npm run db:seed`.
 *
 * Refuses when NODE_ENV=production, on a non-local database, or on a database
 * that already has staff or complaints. Prints the demo logins at the end.
 */
import { config } from "../config.js";
import { closePool } from "../db/client.js";
import { MigrationError, assertResettable } from "../db/migrate.js";
import {
  SEED_COMPLAINANTS,
  SEED_STAFF,
  SeedError,
  seedDatabase,
} from "../db/seed.js";

async function main() {
  assertResettable(config.databaseUrl, "db:seed");

  const summary = await seedDatabase();

  console.log("\nAkaun staf demo (tempatan sahaja):");
  console.table(
    SEED_STAFF.map((s) => ({
      peranan: s.role,
      emel: s.email,
      kata_laluan: s.password,
    })),
  );
  console.log(
    [
      "Log masuk pengadu (kod OTP dicetak di konsol BE semasa `npm run dev`):",
      `  berdaftar  : ${SEED_COMPLAINANTS.identified}`,
      `  tanpa nama : ${SEED_COMPLAINANTS.anonymous}`,
      "",
      `✔ Selesai: ${summary.complaints} aduan, ${summary.meetings} mesyuarat, ${summary.decisions} keputusan, ${summary.caseActions} tindakan kes, ${summary.protectionRequests} permohonan perlindungan`,
    ].join("\n"),
  );
}

main()
  .catch((err: unknown) => {
    const known = err instanceof MigrationError || err instanceof SeedError;
    console.error(
      `✖ ${known ? (err as Error).message : err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
    );
    process.exitCode = 1;
  })
  .finally(() => closePool());
