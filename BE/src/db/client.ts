import pg from "pg";
import { config } from "../config.js";

const { Pool, types } = pg;

/**
 * Postgres DATE (OID 1082) would otherwise be parsed into a JS `Date` at local
 * midnight, which shifts the day by one either side of UTC. Every DATE column
 * here is a calendar date, never an instant — `complaint_date`, `action_date`,
 * `decision_date` — so we keep them as the raw 'YYYY-MM-DD' string.
 */
types.setTypeParser(types.builtins.DATE, (value) => value);

/**
 * BIGINT (OID 20) is deliberately left as a string. Every id in this schema is
 * `BIGINT GENERATED ALWAYS AS IDENTITY`, and converting to a JS number would
 * silently lose precision past 2^53. Ids are opaque handles, so string is fine.
 */

export const pool: pg.Pool = new Pool({
  connectionString: config.databaseUrl,
  max: config.dbPoolMax,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on("error", (err) => {
  console.error("Ralat pool Postgres yang tidak dijangka:", err);
});

/** Run a single parameterised query. Always pass values as `$1`-style params. */
export async function query<T extends pg.QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params as unknown[]);
}

/** First row, or `undefined` when the query matched nothing. */
export async function queryOne<T extends pg.QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T | undefined> {
  const result = await query<T>(text, params);
  return result.rows[0];
}

/**
 * Run `fn` inside a transaction on a single dedicated connection, rolling back
 * on any throw. Multi-statement writes that must not half-apply — registering a
 * complainant plus a complaint, recording a decision plus its signatories —
 * belong in here.
 */
export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
