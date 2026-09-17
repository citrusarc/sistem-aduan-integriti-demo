import type { BarDatum } from "@/components/ui/bar-chart"
import type { StatsBucket } from "@/types/entities"
import { labelFor } from "@/types/enums"

/** A stats dimension as chart data. `null` is "not recorded" and only shown when non-zero. */
export function bucketsToBars<T extends string>(
  buckets: StatsBucket<T>[],
  labels: Record<T, string>
): BarDatum[] {
  return buckets
    .filter((b) => b.value !== null || b.count > 0)
    .map((b) => ({
      key: b.value ?? "__null",
      label: b.value ? labelFor(labels, b.value) : "Tidak direkod",
      value: b.count,
    }))
}

const shortMonth = new Intl.DateTimeFormat("ms-MY", {
  month: "short",
  timeZone: "UTC",
})
const longMonth = new Intl.DateTimeFormat("ms-MY", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
})

/** 'YYYY-MM' buckets as columns; the year is added to short labels only when it varies. */
export function monthsToColumns(months: { month: string; count: number }[]) {
  const years = new Set(months.map((m) => m.month.slice(0, 4)))
  return months.map((m) => {
    const [y, mo] = m.month.split("-").map(Number)
    const date = new Date(Date.UTC(y!, mo! - 1, 1))
    const short = shortMonth.format(date)
    return {
      key: m.month,
      label: longMonth.format(date),
      shortLabel: years.size > 1 ? `${short} ${String(y).slice(2)}` : short,
      value: m.count,
    }
  })
}
