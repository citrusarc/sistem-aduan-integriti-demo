"use client"

import * as React from "react"
import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { errorMessage } from "@/lib/errors"

const backdropClassName =
  "fixed inset-0 z-50 bg-foreground/40 transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0"

const popupClassName =
  "fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100svh-2rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col surface-card border-border/70 bg-card text-card-foreground shadow-lg outline-none transition-[opacity,scale] data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0"

const SIZES = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl" } as const

/**
 * A controlled modal, for forms that don't fit inline (record a decision,
 * create a meeting). The body scrolls; the title and footer stay put.
 */
function Dialog({
  open,
  onOpenChange,
  title,
  description,
  footer,
  size = "md",
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  description?: React.ReactNode
  footer?: React.ReactNode
  size?: keyof typeof SIZES
  children: React.ReactNode
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className={backdropClassName} />
        <DialogPrimitive.Popup className={cn(popupClassName, SIZES[size])}>
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div className="flex flex-col gap-1">
              <DialogPrimitive.Title className="text-lg font-semibold text-primary">
                {title}
              </DialogPrimitive.Title>
              {description && (
                <DialogPrimitive.Description className="text-sm text-muted-foreground">
                  {description}
                </DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close
              render={<Button variant="ghost" size="icon-sm" />}
              aria-label="Tutup"
            >
              <XIcon />
            </DialogPrimitive.Close>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && (
            <div className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-3">
              {footer}
            </div>
          )}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

/**
 * Asks before a write that can't be undone (close a case, sign a slot, mark a
 * meeting done). `onConfirm` may throw; its error is shown inside the dialog
 * and the dialog stays open.
 */
function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  destructive,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  description?: React.ReactNode
  confirmLabel: string
  onConfirm: () => Promise<void>
  destructive?: boolean
  children?: React.ReactNode
}) {
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  function change(next: boolean) {
    if (busy) return
    if (!next) setError(null)
    onOpenChange(next)
  }

  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
      onOpenChange(false)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={change}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Backdrop className={backdropClassName} />
        <AlertDialogPrimitive.Popup
          className={cn(popupClassName, SIZES.sm, "gap-4 p-5")}
        >
          <div className="flex flex-col gap-1.5">
            <AlertDialogPrimitive.Title className="text-lg font-semibold text-primary">
              {title}
            </AlertDialogPrimitive.Title>
            {description && (
              <AlertDialogPrimitive.Description className="text-sm text-muted-foreground">
                {description}
              </AlertDialogPrimitive.Description>
            )}
          </div>
          {children}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <AlertDialogPrimitive.Close
              render={<Button variant="outline" disabled={busy} />}
            >
              Batal
            </AlertDialogPrimitive.Close>
            <Button
              variant={destructive ? "destructive" : "default"}
              disabled={busy}
              onClick={confirm}
            >
              {busy ? "Sedang diproses…" : confirmLabel}
            </Button>
          </div>
        </AlertDialogPrimitive.Popup>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  )
}

export { ConfirmDialog, Dialog }
