import * as React from "react"

import { cn } from "@/lib/utils"

/** A titled card: one block of a page (case details, decisions, actions). */
function Section({
  title,
  description,
  actions,
  className,
  children,
  id,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  className?: string
  children: React.ReactNode
  id?: string
}) {
  const headingId = React.useId()
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={cn(
        "flex flex-col gap-4 surface-card border-border/70 bg-card p-4 md:p-5",
        className
      )}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-0.5">
          <h2 id={headingId} className="text-base font-semibold text-primary">
            {title}
          </h2>
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>
      {children}
    </section>
  )
}

/** Label/value pairs, two columns on wide screens. */
function DetailList({
  items,
  className,
}: {
  items: { label: string; value: React.ReactNode; wide?: boolean }[]
  className?: string
}) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-3 sm:grid-cols-2", className)}>
      {items.map((item) => (
        <div
          key={item.label}
          className={cn(
            "flex min-w-0 flex-col gap-0.5",
            item.wide && "sm:col-span-2"
          )}
        >
          <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {item.label}
          </dt>
          <dd className="text-sm break-words whitespace-pre-line">
            {item.value ?? <span className="text-muted-foreground">—</span>}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** A small inline message for a form or action result. */
function Notice({
  tone = "info",
  className,
  children,
}: {
  tone?: "info" | "error" | "success" | "warning"
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-lg border px-3 py-2 text-sm",
        tone === "info" && "border-border bg-muted/60 text-foreground",
        tone === "error" &&
          "border-destructive/40 bg-destructive/5 text-destructive",
        tone === "success" &&
          "border-status-selesai-foreground/30 bg-status-selesai text-status-selesai-foreground",
        tone === "warning" &&
          "border-accent/40 bg-status-dalam-tindakan text-status-dalam-tindakan-foreground",
        className
      )}
    >
      {children}
    </div>
  )
}

export { DetailList, Notice, Section }
