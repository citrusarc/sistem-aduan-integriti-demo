import { formatDate, formatDateTime, formatMonth } from "@/lib/format"
import { cn } from "@/lib/utils"

type DateDisplayProps = {
  value: string | null | undefined
  /**
   * `date` for DATE columns ('YYYY-MM-DD'), `datetime` for timestamps, `month`
   * for stats buckets ('YYYY-MM').
   */
  kind?: "date" | "datetime" | "month"
  /** Shown when there's no value. */
  fallback?: string
  className?: string
}

/** A date as Malay text inside a machine-readable <time>. */
export function DateDisplay({
  value,
  kind = "date",
  fallback = "—",
  className,
}: DateDisplayProps) {
  const text =
    kind === "datetime"
      ? formatDateTime(value)
      : kind === "month"
        ? formatMonth(value)
        : formatDate(value)

  if (!text || !value) {
    return (
      <span className={cn("text-muted-foreground", className)}>{fallback}</span>
    )
  }

  return (
    <time dateTime={value} className={cn("whitespace-nowrap", className)}>
      {text}
    </time>
  )
}
