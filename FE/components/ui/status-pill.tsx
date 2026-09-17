import { COMPLAINT_STATUS, type ComplaintStatus } from "@/types/enums"
import { cn } from "@/lib/utils"

/**
 * Status badge convention, per the agreed palette:
 *
 *   Baru            neutral grey       no signal yet
 *   Menunggu JMM    navy tint          in the pipeline
 *   Dalam Tindakan  muted gold         active, not alarming
 *   Selesai         muted green        calm resolution
 *   NFA             cool grey-blue     closed, deliberately NOT "success"
 *
 * NFA is not a failure state and Selesai is not a win — an integrity complaint
 * closed with no further action is a legitimate outcome, so neither gets
 * red/green semantics.
 */
const STATUS_CLASSES: Record<ComplaintStatus, string> = {
  BARU: "bg-status-baru text-status-baru-foreground",
  MENUNGGU_JMM: "bg-status-menunggu-jmm text-status-menunggu-jmm-foreground",
  DALAM_TINDAKAN:
    "bg-status-dalam-tindakan text-status-dalam-tindakan-foreground",
  SELESAI: "bg-status-selesai text-status-selesai-foreground",
  NFA: "bg-status-nfa text-status-nfa-foreground",
}

export type StatusPillProps = {
  /** The stored `complaints.status` from the API — see CLAUDE.md §4. */
  status: ComplaintStatus
  className?: string
}

export function StatusPill({ status, className }: StatusPillProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold",
        STATUS_CLASSES[status],
        className
      )}
    >
      {COMPLAINT_STATUS[status]}
    </span>
  )
}
