"use client"

import * as React from "react"
import { PencilIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { DateDisplay } from "@/components/ui/date-display"
import { Dialog } from "@/components/ui/dialog"
import { FormField } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/ui/page-header"
import { Notice } from "@/components/ui/section"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useApiData } from "@/hooks/use-api-data"
import { referralsApi } from "@/lib/api"
import { todayIso } from "@/lib/format"
import { errorMessage } from "@/lib/errors"
import type { ReferredAction } from "@/types/entities"
import { CASE_ACTION_TYPE, labelFor } from "@/types/enums"

/**
 * §8 decision 5 — what a KJ or SUB_UNIT officer sees of the actions referred
 * to them: the reference number and five tracking fields, nothing else (BE
 * selects nothing else). They may update two of them. No link to the case
 * file: that is Integrity Unit material.
 */
export function ReferredActions({
  title,
  description,
}: {
  title: string
  description: string
}) {
  const actions = useApiData("referrals", () => referralsApi.actions())
  const [editing, setEditing] = React.useState<ReferredAction | null>(null)
  const [saved, setSaved] = React.useState<string | null>(null)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={title} description={description} />

      <Notice tone="info">
        Anda boleh mengemas kini tarikh maklum balas diterima dan status maklum
        balas sahaja. Butiran lain aduan adalah sulit kepada Unit Integriti.
      </Notice>

      {saved && <Notice tone="success">{saved}</Notice>}

      {actions.status === "error" ? (
        <ErrorState
          error={actions.error}
          onRetry={() => void actions.reload()}
        />
      ) : !actions.data ? (
        <LoadingState />
      ) : actions.data.length === 0 ? (
        <EmptyState
          title="Tiada tindakan dirujuk kepada anda"
          description="Tindakan yang dirujuk oleh Unit Integriti akan dipaparkan di sini."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>No. rujukan aduan</TableHead>
              <TableHead>Tindakan</TableHead>
              <TableHead>Tarikh tindakan</TableHead>
              <TableHead>No. fail</TableHead>
              <TableHead>Maklum balas diterima</TableHead>
              <TableHead>Status maklum balas</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {actions.data.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="font-medium whitespace-nowrap">
                  {a.complaintRefNo}
                </TableCell>
                <TableCell>
                  {labelFor(CASE_ACTION_TYPE, a.actionTaken)}
                </TableCell>
                <TableCell>
                  <DateDisplay value={a.actionDate} />
                </TableCell>
                <TableCell>
                  {a.fileRefNo ?? (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <DateDisplay value={a.responseReceivedDate} />
                </TableCell>
                <TableCell className="max-w-64">
                  {a.feedbackStatus ?? (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Kemas kini maklum balas ${a.complaintRefNo}`}
                    onClick={() => {
                      setSaved(null)
                      setEditing(a)
                    }}
                  >
                    <PencilIcon data-icon="inline-start" />
                    Kemas kini
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {editing && (
        <FeedbackDialog
          action={editing}
          onClose={() => setEditing(null)}
          onSaved={async (updated) => {
            setEditing(null)
            setSaved(
              `Maklum balas untuk ${updated.complaintRefNo} dikemas kini.`
            )
            await actions.reload()
          }}
        />
      )}
    </div>
  )
}

function FeedbackDialog({
  action,
  onClose,
  onSaved,
}: {
  action: ReferredAction
  onClose: () => void
  onSaved: (updated: ReferredAction) => Promise<void>
}) {
  const [responseReceivedDate, setDate] = React.useState(
    action.responseReceivedDate ?? ""
  )
  const [feedbackStatus, setStatus] = React.useState(
    action.feedbackStatus ?? ""
  )
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      // Exactly the two allowed keys; BE refuses anything else with 422.
      const updated = await referralsApi.updateAction(action.id, {
        responseReceivedDate: responseReceivedDate || null,
        feedbackStatus: feedbackStatus.trim() || null,
      })
      await onSaved(updated)
    } catch (err) {
      setError(errorMessage(err))
      setSaving(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !saving && onClose()}
      title={`Maklum balas — ${action.complaintRefNo}`}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button type="submit" form="feedback-form" disabled={saving}>
            {saving ? "Menyimpan…" : "Simpan"}
          </Button>
        </>
      }
    >
      <form id="feedback-form" onSubmit={save} className="flex flex-col gap-4">
        <FormField label="Tarikh maklum balas diterima">
          <Input
            type="date"
            value={responseReceivedDate}
            max={todayIso()}
            onChange={(e) => setDate(e.target.value)}
          />
        </FormField>
        <FormField label="Status maklum balas">
          <Input
            value={feedbackStatus}
            maxLength={2000}
            onChange={(e) => setStatus(e.target.value)}
          />
        </FormField>
        {error && <Notice tone="error">{error}</Notice>}
      </form>
    </Dialog>
  )
}
