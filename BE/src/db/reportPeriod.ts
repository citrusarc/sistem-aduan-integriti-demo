/**
 * The masterlist files each complaint under the month it reached the unit
 * (`report_month` / `report_year`), in Malaysia time. Used where the server,
 * not a staff member, decides those fields — portal submissions.
 */

export const REPORT_MONTHS = [
  "JANUARI",
  "FEBRUARI",
  "MAC",
  "APRIL",
  "MEI",
  "JUN",
  "JULAI",
  "OGOS",
  "SEPTEMBER",
  "OKTOBER",
  "NOVEMBER",
  "DISEMBER",
] as const;

/** Today in Asia/Kuala_Lumpur: 'YYYY-MM-DD' plus the masterlist month and year. */
export function malaysiaToday(now: Date = new Date()): {
  date: string;
  reportYear: number;
  reportMonth: (typeof REPORT_MONTHS)[number];
} {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
  }).format(now);
  const [year, month] = date.split("-").map(Number);
  return { date, reportYear: year!, reportMonth: REPORT_MONTHS[month! - 1]! };
}
