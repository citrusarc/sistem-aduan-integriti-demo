import * as React from "react"

import { cn } from "@/lib/utils"

const TONES = {
  neutral: "bg-muted text-muted-foreground",
  primary: "bg-status-menunggu-jmm text-status-menunggu-jmm-foreground",
  accent: "bg-status-dalam-tindakan text-status-dalam-tindakan-foreground",
  calm: "bg-status-selesai text-status-selesai-foreground",
  outline: "border border-border text-foreground",
} as const

/**
 * A small label for things that aren't a complaint status (quorum, meeting
 * state, lock). Complaint statuses always go through StatusPill.
 */
function Badge({
  tone = "neutral",
  className,
  ...props
}: React.ComponentProps<"span"> & { tone?: keyof typeof TONES }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3.5",
        TONES[tone],
        className
      )}
      {...props}
    />
  )
}

export { Badge }
