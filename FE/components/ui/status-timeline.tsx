import { DateDisplay } from "@/components/ui/date-display"
import { StatusPill } from "@/components/ui/status-pill"
import { cn } from "@/lib/utils"
import type { StatusTimelineEntry } from "@/types/entities"

/**
 * A complaint's status history, newest first (§8 decision 13). Only status and
 * time exist in this data, so it is as safe to show the public as the status
 * itself.
 */
export function StatusTimeline({
  entries,
  className,
}: {
  entries: StatusTimelineEntry[]
  className?: string
}) {
  if (entries.length === 0) return null
  const newestFirst = [...entries].reverse()
  return (
    <ol aria-label="Sejarah status" className={cn("flex flex-col", className)}>
      {newestFirst.map((entry, index) => {
        const current = index === 0
        const last = index === newestFirst.length - 1
        return (
          <li
            key={`${entry.changedAt}-${entry.status}-${index}`}
            className="relative flex gap-3 pb-5 last:pb-0"
          >
            {!last && (
              <span
                aria-hidden
                className="absolute top-4 left-[7px] h-full w-px bg-border"
              />
            )}
            <span
              aria-hidden
              className={cn(
                "relative mt-1 size-[15px] shrink-0 rounded-full border-2",
                current
                  ? "border-primary bg-primary ring-4 ring-primary/15"
                  : "border-border bg-card"
              )}
            />
            <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <StatusPill status={entry.status} />
              <span className="text-xs text-muted-foreground">
                <DateDisplay value={entry.changedAt} kind="datetime" />
              </span>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
