"use client"

import * as React from "react"
import {
  AlertTriangleIcon,
  InboxIcon,
  Loader2Icon,
  ShieldOffIcon,
  WifiOffIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { describeError } from "@/lib/errors"
import { cn } from "@/lib/utils"

/**
 * Loading, empty and error states, so every page says the same thing the same
 * way. Error text comes from BE where it's meant for the user (404/409/422
 * messages are already in Malay); transport failures get a generic message.
 */

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  )
}

function LoadingState({
  label = "Memuatkan…",
  className,
}: {
  label?: string
  className?: string
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex flex-col items-center justify-center gap-3 py-12 text-sm text-muted-foreground",
        className
      )}
    >
      <Loader2Icon className="size-6 animate-spin text-primary" aria-hidden />
      <span>{label}</span>
    </div>
  )
}

function StateFrame({
  icon,
  title,
  description,
  action,
  tone = "muted",
  className,
  role,
}: {
  icon: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  tone?: "muted" | "error"
  className?: string
  role?: "alert"
}) {
  return (
    <div
      role={role}
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed px-6 py-12 text-center",
        tone === "error"
          ? "border-destructive/40 bg-destructive/5"
          : "border-border bg-card",
        className
      )}
    >
      <div
        className={cn(
          "flex size-10 items-center justify-center rounded-full",
          tone === "error"
            ? "bg-destructive/10 text-destructive"
            : "bg-muted text-muted-foreground"
        )}
        aria-hidden
      >
        {icon}
      </div>
      <div className="flex max-w-md flex-col gap-1">
        <p className="font-medium text-foreground">{title}</p>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action}
    </div>
  )
}

function EmptyState({
  title = "Tiada rekod",
  description,
  action,
  className,
}: {
  title?: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <StateFrame
      icon={<InboxIcon className="size-5" />}
      title={title}
      description={description}
      action={action}
      className={className}
    />
  )
}

function ErrorState({
  error,
  onRetry,
  className,
}: {
  error: unknown
  onRetry?: () => void
  className?: string
}) {
  const { title, description, kind } = describeError(error)
  const icon =
    kind === "network" ? (
      <WifiOffIcon className="size-5" />
    ) : kind === "forbidden" ? (
      <ShieldOffIcon className="size-5" />
    ) : (
      <AlertTriangleIcon className="size-5" />
    )

  return (
    <StateFrame
      role="alert"
      tone="error"
      icon={icon}
      title={title}
      description={description}
      className={className}
      action={
        onRetry && kind !== "forbidden" ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            Cuba lagi
          </Button>
        ) : undefined
      }
    />
  )
}

export { describeError }
export { EmptyState, ErrorState, LoadingState, Skeleton }
