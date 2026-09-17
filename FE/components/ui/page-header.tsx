import * as React from "react"
import { ConstructionIcon } from "lucide-react"

import { cn } from "@/lib/utils"

function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <header
      className={cn(
        "flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-end sm:justify-between",
        className
      )}
    >
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-primary">
          {title}
        </h1>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  )
}

/**
 * Stand-in body for a route that exists (so navigation and access checks can
 * be exercised) but whose feature isn't built yet. Replace, don't extend.
 */
function PagePlaceholder({ note }: { note?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-card px-6 py-14 text-center">
      <ConstructionIcon className="size-6 text-accent" aria-hidden />
      <p className="font-medium">Halaman ini belum dibina</p>
      <p className="max-w-md text-sm text-muted-foreground">
        {note ?? "Kandungan akan ditambah dalam fasa pembangunan seterusnya."}
      </p>
    </div>
  )
}

export { PageHeader, PagePlaceholder }
