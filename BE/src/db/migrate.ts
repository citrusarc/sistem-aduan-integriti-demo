/**
 * Migration runner used by `npm run db:migrate` / `db:reset` (src/scripts/db.ts)
 * and by the test harness.
 *
 * Applied files are recorded in `schema_migrations` with a SHA-256 of their
 * contents. A file already recorded is skipped; a recorded file whose contents
 * have since changed is refused — applied migrations are never edited, a new
 * numbered file is added instead.
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

/** A refusal or failure to report to the operator, without a stack trace. */
export class MigrationError extends Error {}

type Logger = (message: string) => void;

export type MigrateOptions = {
  /** Adopt a hand-built database: mark schema.sql + migrations up to NNN as applied. */
  baseline?: string;
  log?: Logger;
};

const DB_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../db",
);
const MIGRATION_FILE = /^(\d{3})_[a-z0-9_]+\.sql$/;
/** Arbitrary constant; stops two `db:migrate` runs interleaving. */
const MIGRATE_LOCK_KEY = 4_815_162_342;

type MigrationFile = { name: string; sql: string; checksum: string };

function checksum(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

/** schema.sql first, then db/migrations/NNN_*.sql in numeric order. */
async function loadFiles(): Promise<MigrationFile[]> {
  const load = async (name: string, file: string) => {
    const sql = await readFile(file, "utf8");
    return { name, sql, checksum: checksum(sql) };
  };

  const entries = (await readdir(path.join(DB_DIR, "migrations"))).sort();
  const stray = entries.filter(
    (e) => e.endsWith(".sql") && !MIGRATION_FILE.test(e),
  );
  if (stray.length > 0) {
    throw new MigrationError(
      `Nama fail migrasi tidak sah (perlu NNN_nama.sql): ${stray.join(", ")}`,
    );
  }

  const numbers = new Set<string>();
  for (const name of entries.filter((e) => MIGRATION_FILE.test(e))) {
    const number = name.slice(0, 3);
    if (numbers.has(number))
      throw new MigrationError(`Nombor migrasi berulang: ${number}`);
    numbers.add(number);
  }

  return [
    await load("schema.sql", path.join(DB_DIR, "schema.sql")),
    ...(await Promise.all(
      entries
        .filter((e) => MIGRATION_FILE.test(e))
        .map((e) =>
          load(`migrations/${e}`, path.join(DB_DIR, "migrations", e)),
        ),
    )),
  ];
}

export async function migrate(
  databaseUrl: string,
  { baseline, log = console.log }: MigrateOptions = {},
): Promise<void> {
  const files = await loadFiles();
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATE_LOCK_KEY]);

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name        TEXT PRIMARY KEY,
        checksum    TEXT NOT NULL,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);

    const { rows } = await client.query<{ name: string; checksum: string }>(
      "SELECT name, checksum FROM schema_migrations",
    );
    const applied = new Map(rows.map((r) => [r.name, r.checksum]));

    if (applied.size === 0) {
      const { rows: existing } = await client.query<{ found: string | null }>(
        "SELECT to_regclass('public.complaints')::text AS found",
      );
      const hasTables = existing[0]?.found != null;

      if (baseline) {
        if (!hasTables)
          throw new MigrationError(
            "--baseline hanya untuk pangkalan data yang sudah ada jadual",
          );
        for (const file of await recordBaseline(client, files, baseline, log)) {
          applied.set(file.name, file.checksum);
        }
      } else if (hasTables) {
        throw new MigrationError(
          "Pangkalan data ini sudah ada jadual tetapi tiada rekod schema_migrations.\n" +
            "  Sama ada: npm run db:reset   (memadam semua data tempatan)\n" +
            "  atau:     npm run db:migrate -- --baseline <NNN>   (migrasi terakhir yang telah digunakan secara manual)",
        );
      }
    } else if (baseline) {
      throw new MigrationError(
        "--baseline hanya boleh digunakan sekali, pada pangkalan data tanpa rekod migrasi",
      );
    }

    let ran = 0;
    for (const file of files) {
      const recorded = applied.get(file.name);
      if (recorded !== undefined) {
        if (recorded !== file.checksum) {
          throw new MigrationError(
            `${file.name} telah diubah selepas digunakan. Jangan sunting migrasi yang sudah digunakan — ` +
              "tambah fail bernombor baharu, atau jalankan npm run db:reset secara tempatan.",
          );
        }
        continue;
      }

      log(`→ ${file.name}`);
      // One simple-protocol query: the file plus its bookkeeping row. A file
      // with no BEGIN/COMMIT of its own runs as a single implicit transaction
      // together with the INSERT, so it applies and records atomically. The
      // leading newline stops a trailing `-- comment` swallowing the INSERT.
      try {
        await client.query(
          `${file.sql}\n;\nINSERT INTO schema_migrations (name, checksum) VALUES (${client.escapeLiteral(file.name)}, ${client.escapeLiteral(file.checksum)});`,
        );
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw new MigrationError(
          `${file.name} gagal: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      ran += 1;
    }

    log(
      ran === 0
        ? "✔ Pangkalan data sudah terkini; tiada migrasi baharu"
        : `✔ ${ran} fail digunakan`,
    );
  } finally {
    await client.end();
  }
}

async function recordBaseline(
  client: pg.Client,
  files: MigrationFile[],
  through: string,
  log: Logger,
): Promise<MigrationFile[]> {
  if (!/^\d{3}$/.test(through))
    throw new MigrationError("--baseline perlu nombor tiga digit, cth. 003");
  const last = files.findIndex((f) =>
    f.name.startsWith(`migrations/${through}_`),
  );
  if (last === -1)
    throw new MigrationError(`Tiada migrasi bernombor ${through}`);

  const adopted = files.slice(0, last + 1);
  for (const file of adopted) {
    await client.query(
      "INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)",
      [file.name, file.checksum],
    );
  }
  log(
    `✔ Ditandakan sebagai sudah digunakan: ${adopted.map((f) => f.name).join(", ")}`,
  );
  return adopted;
}

const LOCAL_HOSTS = new Set(["", "localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Refuses anything but a local, non-system database outside production.
 * Exported so the test harness applies the same guard before it resets.
 */
export function assertResettable(
  databaseUrl: string,
  command = "db:reset",
): void {
  if (process.env.NODE_ENV === "production") {
    throw new MigrationError(`${command} dilarang apabila NODE_ENV=production`);
  }

  const url = new URL(databaseUrl);
  const socketHost = url.searchParams.get("host");
  const isLocal =
    LOCAL_HOSTS.has(url.hostname) &&
    (socketHost === null ||
      socketHost.startsWith("/") ||
      LOCAL_HOSTS.has(socketHost));
  if (!isLocal) {
    throw new MigrationError(
      `${command} hanya untuk pangkalan data tempatan (hos: ${socketHost ?? url.hostname})`,
    );
  }

  const dbName = decodeURIComponent(url.pathname.slice(1));
  if (!dbName || dbName === "postgres" || dbName.startsWith("template")) {
    throw new MigrationError(`Enggan memadam pangkalan data "${dbName}"`);
  }
}

export async function reset(
  databaseUrl: string,
  { log = console.log }: { log?: Logger } = {},
): Promise<void> {
  assertResettable(databaseUrl);
  const url = new URL(databaseUrl);
  const dbName = decodeURIComponent(url.pathname.slice(1));

  const maintenanceUrl = new URL(url);
  maintenanceUrl.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: maintenanceUrl.toString() });
  await admin.connect();
  try {
    const ident = admin.escapeIdentifier(dbName);
    await admin.query(`DROP DATABASE IF EXISTS ${ident} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${ident}`);
    log(`✔ Pangkalan data ${dbName} dicipta semula`);
  } finally {
    await admin.end();
  }

  await migrate(databaseUrl, { log });
}
