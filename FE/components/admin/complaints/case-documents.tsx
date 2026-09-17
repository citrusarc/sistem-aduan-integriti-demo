"use client"

import * as React from "react"

import {
  DocumentIcon,
  DocumentPicker,
  formatFileSize,
} from "@/components/complaints/document-picker"
import { Button } from "@/components/ui/button"
import { DateDisplay } from "@/components/ui/date-display"
import { Notice } from "@/components/ui/section"
import { adminApi } from "@/lib/api"
import { errorMessage } from "@/lib/errors"
import type { ComplaintAttachment } from "@/types/entities"

/** BE's per-complaint cap (config.uploads.maxFilesPerComplaint). */
const MAX_PER_COMPLAINT = 20

/**
 * DOKUMEN SOKONGAN on the case file (§8 decision 10): what the complainant
 * attached, plus documents staff add later. Downloads are plain links — BE
 * serves them as attachments with the staff cookie, never inline.
 */
export function CaseDocuments({
  complaintId,
  attachments,
  onChanged,
}: {
  complaintId: string
  attachments: ComplaintAttachment[]
  onChanged: () => void
}) {
  const [adding, setAdding] = React.useState(false)
  const [files, setFiles] = React.useState<File[]>([])
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const room = Math.max(0, MAX_PER_COMPLAINT - attachments.length)

  async function upload() {
    setBusy(true)
    setError(null)
    try {
      await adminApi.complaints.uploadAttachments(complaintId, files)
      setFiles([])
      setAdding(false)
      onChanged()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {attachments.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Tiada dokumen dilampirkan.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {attachments.map((a) => (
            <li
              key={a.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-border/70 bg-muted/30 px-3 py-2.5"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-card text-secondary ring-1 ring-border/70">
                <DocumentIcon name={a.originalName} className="size-4" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <a
                  href={adminApi.complaints.attachmentDownloadUrl(
                    complaintId,
                    a.id
                  )}
                  download
                  className="truncate text-sm font-medium text-primary underline-offset-4 hover:underline"
                >
                  {a.originalName}
                </a>
                <span className="text-xs text-muted-foreground">
                  {formatFileSize(a.sizeBytes)} ·{" "}
                  {a.uploadedBy
                    ? `Dimuat naik oleh ${a.uploadedBy.fullName ?? "kakitangan"}`
                    : "Dilampirkan oleh pengadu"}{" "}
                  · <DateDisplay value={a.createdAt} kind="datetime" />
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="flex flex-col gap-3 rounded-xl border border-border/70 p-4">
          <DocumentPicker
            files={files}
            onChange={setFiles}
            disabled={busy}
            maxFiles={Math.min(5, room)}
            note="Dokumen yang diterima selepas pendaftaran, contohnya melalui e-mel pengadu."
          />
          {error && <Notice tone="error">{error}</Notice>}
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setAdding(false)
                setFiles([])
                setError(null)
              }}
            >
              Batal
            </Button>
            <Button disabled={busy || files.length === 0} onClick={upload}>
              {busy ? "Memuat naik…" : `Muat naik ${files.length || ""} fail`}
            </Button>
          </div>
        </div>
      ) : (
        room > 0 && (
          <div>
            <Button variant="outline" onClick={() => setAdding(true)}>
              Tambah dokumen
            </Button>
          </div>
        )
      )}
    </div>
  )
}
