"use client"

import * as React from "react"
import { FileTextIcon, ImageIcon } from "lucide-react"

import { Button, buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * Supporting-document picker (§8 decision 10), for the portal submission and
 * the staff case file. Checks here mirror BE (types, size, count) so a
 * mistake is caught before sending; BE checks the file content regardless.
 */

export const DOCUMENT_LIMITS = {
  maxFiles: 5,
  maxBytes: 10 * 1024 * 1024,
  accept: ".pdf,.jpg,.jpeg,.png,.docx",
  label: "PDF, JPG, PNG atau DOCX · maksimum 5 fail, 10 MB setiap satu",
} as const

const ALLOWED_EXTENSIONS = /\.(pdf|jpe?g|png|docx)$/i

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function DocumentIcon({
  name,
  className,
}: {
  name: string
  className?: string
}) {
  const Icon = /\.(jpe?g|png)$/i.test(name) ? ImageIcon : FileTextIcon
  return <Icon className={className} aria-hidden />
}

export function DocumentPicker({
  files,
  onChange,
  disabled,
  maxFiles = DOCUMENT_LIMITS.maxFiles,
  note,
}: {
  files: File[]
  onChange: (files: File[]) => void
  disabled?: boolean
  maxFiles?: number
  note?: React.ReactNode
}) {
  const inputId = React.useId()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [problems, setProblems] = React.useState<string[]>([])
  const [dragging, setDragging] = React.useState(false)

  function add(incoming: FileList | null) {
    if (!incoming?.length) return
    const next = [...files]
    const found: string[] = []
    for (const file of Array.from(incoming)) {
      if (!ALLOWED_EXTENSIONS.test(file.name)) {
        found.push(`${file.name}: jenis fail tidak dibenarkan`)
      } else if (file.size > DOCUMENT_LIMITS.maxBytes) {
        found.push(`${file.name}: melebihi 10 MB`)
      } else if (file.size === 0) {
        found.push(`${file.name}: fail kosong`)
      } else if (
        next.some((f) => f.name === file.name && f.size === file.size)
      ) {
        continue
      } else if (next.length >= maxFiles) {
        found.push(`${file.name}: maksimum ${maxFiles} fail`)
      } else {
        next.push(file)
      }
    }
    setProblems(found)
    onChange(next)
    // Lets the same file be picked again after removing it.
    if (inputRef.current) inputRef.current.value = ""
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        onDragOver={(e) => {
          if (disabled) return
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          if (!disabled) add(e.dataTransfer.files)
        }}
        className={cn(
          "flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-muted/30 px-4 py-6 text-center transition-colors",
          dragging && "border-primary bg-status-menunggu-jmm/50",
          disabled && "opacity-60"
        )}
      >
        <p className="text-sm">Seret fail ke sini, atau</p>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          multiple
          accept={DOCUMENT_LIMITS.accept}
          disabled={disabled || files.length >= maxFiles}
          onChange={(e) => add(e.target.files)}
          className="peer sr-only"
        />
        <label
          htmlFor={inputId}
          className={cn(
            buttonVariants({ variant: "outline-cta" }),
            "peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50 peer-disabled:pointer-events-none peer-disabled:opacity-50"
          )}
        >
          Pilih fail
        </label>
        <p className="text-xs text-muted-foreground">{DOCUMENT_LIMITS.label}</p>
      </div>

      {problems.length > 0 && (
        <ul
          role="alert"
          className="flex flex-col gap-0.5 text-xs text-destructive"
        >
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      {files.length > 0 && (
        <ul aria-label="Fail dipilih" className="flex flex-col gap-2">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${file.size}-${index}`}
              className="flex items-center gap-3 rounded-xl border border-border/70 bg-card px-3 py-2"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-secondary">
                <DocumentIcon name={file.name} className="size-4" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">
                  {file.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatFileSize(file.size)}
                </span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => {
                  setProblems([])
                  onChange(files.filter((_, i) => i !== index))
                }}
                aria-label={`Buang ${file.name}`}
              >
                Buang
              </Button>
            </li>
          ))}
        </ul>
      )}

      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  )
}
