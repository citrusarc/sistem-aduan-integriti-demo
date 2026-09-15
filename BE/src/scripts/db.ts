/**
 * Local database management.
 *
 *   npm run db:migrate                     apply schema.sql, then each migration
 *   npm run db:migrate -- --baseline 003   adopt a DB that was set up by hand
 *   npm run db:reset                       drop + recreate + migrate (local only)
 *
 * The runner itself lives in src/db/migrate.ts.
 */
import { config } from "../config.js";
import { MigrationError, migrate, reset } from "../db/migrate.js";

function fail(message: string): never {
  console.error(`✖ ${message}`);
  process.exit(1);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case "migrate": {
      const flag = args.indexOf("--baseline");
      const baseline = flag === -1 ? undefined : args[flag + 1];
      if (flag !== -1 && !baseline) {
        fail("Guna: db:migrate -- --baseline <NNN>");
      }
      await migrate(config.databaseUrl, { baseline });
      break;
    }
    case "reset":
      await reset(config.databaseUrl);
      break;
    default:
      fail("Arahan: migrate | reset");
  }
}

main().catch((err: unknown) => {
  if (err instanceof MigrationError) fail(err.message);
  fail(err instanceof Error ? (err.stack ?? err.message) : String(err));
});
