import { queryOne } from "../client.js";
import {
  COMPLAINT_STATUS,
  INTEGRITY_CATEGORY,
  SECTOR,
  SOURCE_CHANNEL,
} from "../../types/enums.js";

/**
 * Dashboard / report counts. Integrity Unit only — this counts NFA cases, so
 * it must never be exposed outside that gate (rule 2).
 *
 * Status is the stored `complaints.status` (§8 decision 1), so these counts
 * are safe for reporting; no bucket is inferred from free text.
 *
 * Period: a complaint's month is its `received_date_ui` (TARIKH TERIMA DI UI),
 * falling back to `complaint_date`, then the day it was registered here. The
 * masterlist's own `report_month` is free text with no fixed format, so it
 * can't be grouped or filtered reliably.
 */
const PERIOD_DATE_SQL =
  "COALESCE(received_date_ui, complaint_date, (created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date)";

export type Bucket<T extends string> = { value: T | null; count: number };

export type ComplaintStats = {
  total: number;
  byStatus: Bucket<(typeof COMPLAINT_STATUS)[number]>[];
  byIntegrityCategory: Bucket<(typeof INTEGRITY_CATEGORY)[number]>[];
  bySector: Bucket<(typeof SECTOR)[number]>[];
  bySourceChannel: Bucket<(typeof SOURCE_CHANNEL)[number]>[];
  /** 'YYYY-MM', ascending. */
  byMonth: { month: string; count: number }[];
};

type RawCounts = { value: string | null; count: number }[] | null;

/**
 * Every enum value appears, zero-filled, in enum order — a chart shouldn't
 * lose a bar because nothing fell in it this month. A `null` bucket (field not
 * recorded) is appended only when non-empty.
 */
function fill<T extends string>(
  values: readonly T[],
  raw: RawCounts,
): Bucket<T>[] {
  const counts = new Map((raw ?? []).map((r) => [r.value, r.count]));
  const buckets: Bucket<T>[] = values.map((value) => ({
    value,
    count: counts.get(value) ?? 0,
  }));
  const unrecorded = counts.get(null);
  if (unrecorded) buckets.push({ value: null, count: unrecorded });
  return buckets;
}

function monthsOf(year: number, month?: number): string[] {
  const months = month ? [month] : Array.from({ length: 12 }, (_, i) => i + 1);
  return months.map((m) => `${year}-${String(m).padStart(2, "0")}`);
}

export async function getComplaintStats(filters: {
  year?: number;
  month?: number;
}): Promise<ComplaintStats> {
  const counts = (column: string) => `
    (SELECT json_agg(json_build_object('value', v, 'count', n))
       FROM (SELECT ${column}::text AS v, count(*)::int AS n FROM f GROUP BY 1) g)`;

  const row = await queryOne<{
    total: number;
    by_status: RawCounts;
    by_integrity_category: RawCounts;
    by_sector: RawCounts;
    by_source_channel: RawCounts;
    by_month: { month: string; count: number }[] | null;
  }>(
    `WITH f AS (
       SELECT status, integrity_category, sector, source_channel,
              ${PERIOD_DATE_SQL} AS period
         FROM complaints
        WHERE ($1::int IS NULL OR extract(year  FROM ${PERIOD_DATE_SQL}) = $1)
          AND ($2::int IS NULL OR extract(month FROM ${PERIOD_DATE_SQL}) = $2)
     )
     SELECT (SELECT count(*)::int FROM f) AS total,
            ${counts("status")} AS by_status,
            ${counts("integrity_category")} AS by_integrity_category,
            ${counts("sector")} AS by_sector,
            ${counts("source_channel")} AS by_source_channel,
            (SELECT json_agg(json_build_object('month', m, 'count', n) ORDER BY m)
               FROM (SELECT to_char(period, 'YYYY-MM') AS m, count(*)::int AS n
                       FROM f GROUP BY 1) g) AS by_month`,
    [filters.year ?? null, filters.month ?? null],
  );

  const byMonthRaw = row?.by_month ?? [];
  const byMonth =
    filters.year === undefined
      ? byMonthRaw
      : monthsOf(filters.year, filters.month).map((month) => ({
          month,
          count: byMonthRaw.find((r) => r.month === month)?.count ?? 0,
        }));

  return {
    total: row?.total ?? 0,
    byStatus: fill(COMPLAINT_STATUS, row?.by_status ?? null),
    byIntegrityCategory: fill(
      INTEGRITY_CATEGORY,
      row?.by_integrity_category ?? null,
    ),
    bySector: fill(SECTOR, row?.by_sector ?? null),
    bySourceChannel: fill(SOURCE_CHANNEL, row?.by_source_channel ?? null),
    byMonth,
  };
}
