/**
 * Display formatting. Malay, Malaysian time.
 *
 * DATE columns travel as 'YYYY-MM-DD' and are calendar dates, not instants:
 * `new Date("2026-04-15")` is UTC midnight and shows as the 14th in any zone
 * west of UTC. They're formatted from their parts in UTC so the day never
 * shifts. Timestamps are real instants and shown in Asia/Kuala_Lumpur, fixed,
 * so the server render and the browser render produce the same text.
 */

const LOCALE = "ms-MY"
const TIME_ZONE = "Asia/Kuala_Lumpur"

const dateFormat = new Intl.DateTimeFormat(LOCALE, {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
})

const dateTimeFormat = new Intl.DateTimeFormat(LOCALE, {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: TIME_ZONE,
})

const monthFormat = new Intl.DateTimeFormat(LOCALE, {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
})

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const CALENDAR_MONTH = /^(\d{4})-(\d{2})$/

/** 'YYYY-MM-DD' -> "15 Apr 2026". Null or malformed -> null. */
export function formatDate(value: string | null | undefined): string | null {
  const match = value ? CALENDAR_DATE.exec(value) : null
  if (!match) return null
  const [, y, m, d] = match
  return dateFormat.format(new Date(Date.UTC(+y!, +m! - 1, +d!)))
}

/** ISO timestamp -> "15 Apr 2026, 10:05" in Malaysia time. */
export function formatDateTime(
  value: string | null | undefined
): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : dateTimeFormat.format(date)
}

/** 'YYYY-MM' -> "April 2026". */
export function formatMonth(value: string | null | undefined): string | null {
  const match = value ? CALENDAR_MONTH.exec(value) : null
  if (!match) return null
  return monthFormat.format(new Date(Date.UTC(+match[1]!, +match[2]! - 1, 1)))
}

/** Now in Malaysia as 'YYYY-MM-DDTHH:mm', for a datetime-local input's default. */
export function nowMalaysiaInput(): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value])
  )
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

/**
 * A datetime-local value, read as Malaysia time (UTC+8, no DST) whatever the
 * browser's zone, -> ISO instant in UTC as BE expects. Malformed -> null.
 */
export function malaysiaInputToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null
  const date = new Date(`${value}:00+08:00`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** Today in Malaysia as 'YYYY-MM-DD', e.g. for a date input's default. */
export function todayIso(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(
    new Date()
  )
}
